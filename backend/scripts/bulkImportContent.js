#!/usr/bin/env node
/**
 * Bulk-import many titles (with real video + poster files) in one run.
 *
 * Usage:
 *   node scripts/bulkImportContent.js <manifest.json> [--dry-run] [--force]
 *
 *   --dry-run   Validate the manifest and local file paths, upload nothing,
 *               write nothing to MongoDB.
 *   --force     Re-import titles that already exist in MongoDB (creates a
 *               duplicate document instead of skipping).
 *
 * Manifest format: see scripts/content-manifest.example.json
 *   - Film / Documentary / Live: set "videoPath" on the item itself.
 *   - Series / Serial Drama: set "seasons[].episodes[].videoPath" instead.
 *   - "posterPath" / "backdropPath" are optional local image files.
 *
 * Uploads are cached in scripts/.bulk-import-cache.json keyed by file path +
 * size + mtime, so re-running after a crash or network error skips assets
 * that already finished uploading instead of re-uploading large video files.
 *
 * Requires the same env vars as uploadVideo.js / uploadPoster.js:
 *   BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_CDN_PULL_ZONE
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
import '../src/config/env.js'
import { readFileSync, writeFileSync, statSync, existsSync } from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import { connectMongoDB } from '../src/config/mongodb.js'
import { Content } from '../src/models/Content.js'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID
const bunnyKey   = process.env.BUNNY_STREAM_API_KEY
const pullZone   = process.env.BUNNY_CDN_PULL_ZONE

const [, , manifestArg, ...flags] = process.argv
const dryRun = flags.includes('--dry-run')
const force  = flags.includes('--force')

if (!manifestArg) {
  console.error('Usage: node scripts/bulkImportContent.js <manifest.json> [--dry-run] [--force]')
  process.exit(1)
}

const manifestPath = path.resolve(manifestArg)
if (!existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const defaults = manifest.defaults || {}
const items    = manifest.items || []

if (items.length === 0) {
  console.error('Manifest has no items.')
  process.exit(1)
}

const cachePath = path.resolve(import.meta.dirname, '.bulk-import-cache.json')
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}

function saveCache() {
  if (!dryRun) writeFileSync(cachePath, JSON.stringify(cache, null, 2))
}

function cacheKey(filePath) {
  const stat = statSync(filePath)
  return `${filePath}::${stat.size}::${stat.mtimeMs}`
}

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function uploadPosterFile(filePath, publicId, kind = 'poster') {
  const key = cacheKey(filePath)
  if (cache[key]) return cache[key]

  const transformation = kind === 'backdrop'
    ? [{ width: 1280, height: 720, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' }]
    : [{ width: 800, height: 1200, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' }]

  const result = await cloudinary.uploader.upload(filePath, {
    folder: `dhara/${kind}s`,
    public_id: publicId,
    overwrite: true,
    transformation,
  })

  cache[key] = result.secure_url
  saveCache()
  return result.secure_url
}

async function uploadVideoFile(filePath, title) {
  const key = cacheKey(filePath)
  if (cache[key]) return cache[key]

  if (!libraryId || !bunnyKey) {
    throw new Error('Missing BUNNY_STREAM_LIBRARY_ID or BUNNY_STREAM_API_KEY in env.')
  }

  const createRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
    method: 'POST',
    headers: { AccessKey: bunnyKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!createRes.ok) throw new Error(`Bunny create video failed: ${await createRes.text()}`)
  const { guid } = await createRes.json()

  const fileBuffer = readFileSync(filePath)
  const uploadRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${guid}`, {
    method: 'PUT',
    headers: { AccessKey: bunnyKey, 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
  })
  if (!uploadRes.ok) throw new Error(`Bunny upload failed: ${await uploadRes.text()}`)

  cache[key] = guid
  saveCache()
  return guid
}

function resolveLocal(p) {
  return path.isAbsolute(p) ? p : path.resolve(path.dirname(manifestPath), p)
}

function validateItem(item, index) {
  const errors = []
  if (!item.title) errors.push('missing "title"')
  if (!item.type) errors.push('missing "type"')

  const isEpisodic = item.type === 'Series' || item.type === 'Serial Drama'
  if (isEpisodic) {
    const seasons = item.seasons || []
    if (seasons.length === 0) errors.push('episodic type but no "seasons"')
    for (const season of seasons) {
      for (const ep of season.episodes || []) {
        if (!ep.videoPath) {
          errors.push(`season ${season.number} episode ${ep.number} missing "videoPath"`)
        } else if (!existsSync(resolveLocal(ep.videoPath))) {
          errors.push(`season ${season.number} episode ${ep.number} videoPath not found: ${ep.videoPath}`)
        }
      }
    }
  } else if (item.videoPath && !existsSync(resolveLocal(item.videoPath))) {
    errors.push(`videoPath not found: ${item.videoPath}`)
  }

  if (item.posterPath && !existsSync(resolveLocal(item.posterPath))) {
    errors.push(`posterPath not found: ${item.posterPath}`)
  }
  if (item.backdropPath && !existsSync(resolveLocal(item.backdropPath))) {
    errors.push(`backdropPath not found: ${item.backdropPath}`)
  }

  if (errors.length) console.error(`[item ${index}] "${item.title || '?'}": ${errors.join('; ')}`)
  return errors.length === 0
}

async function buildContentDoc(item) {
  const slug = slugify(item.title)
  const doc = {
    ...defaults,
    ...item,
  }
  delete doc.videoPath
  delete doc.posterPath
  delete doc.backdropPath
  delete doc.seasons

  if (item.posterPath) {
    doc.posterUrl = await uploadPosterFile(resolveLocal(item.posterPath), slug, 'poster')
  }
  if (item.backdropPath) {
    doc.backdropUrl = await uploadPosterFile(resolveLocal(item.backdropPath), `${slug}-backdrop`, 'backdrop')
  }

  const isEpisodic = item.type === 'Series' || item.type === 'Serial Drama'
  if (isEpisodic) {
    doc.seasons = []
    for (const season of item.seasons) {
      const episodes = []
      for (const ep of season.episodes) {
        const bunnyVideoId = await uploadVideoFile(
          resolveLocal(ep.videoPath),
          `${item.title} S${season.number}E${ep.number}`
        )
        episodes.push({ ...ep, videoPath: undefined, bunnyVideoId })
      }
      doc.seasons.push({ number: season.number, title: season.title || '', episodes })
    }
  } else if (item.videoPath) {
    doc.bunnyVideoId = await uploadVideoFile(resolveLocal(item.videoPath), item.title)
  }

  return doc
}

async function main() {
  console.log(`Loaded manifest with ${items.length} item(s). ${dryRun ? '[dry run]' : ''}`)

  const valid = items.filter((item, i) => validateItem(item, i))
  if (valid.length < items.length) {
    console.error(`\n${items.length - valid.length} item(s) failed validation — fix the manifest and re-run.`)
    process.exit(1)
  }

  if (dryRun) {
    console.log('Dry run OK — all file paths resolved. No uploads or DB writes performed.')
    return
  }

  await connectMongoDB()

  const created = []
  const skipped = []
  const failed  = []

  for (const item of items) {
    try {
      if (!force) {
        const existing = await Content.findOne({ title: item.title }).lean()
        if (existing) {
          console.log(`⏭  Skipping "${item.title}" — already exists (use --force to re-import).`)
          skipped.push(item.title)
          continue
        }
      }

      console.log(`\n→ Importing "${item.title}" (${item.type})...`)
      const doc = await buildContentDoc(item)
      doc.isPublished = doc.isPublished ?? true
      doc.submissionStatus = doc.submissionStatus || 'approved'

      const result = await Content.create(doc)
      console.log(`  ✓ Created Content ${result._id}`)
      created.push(item.title)
    } catch (err) {
      console.error(`  ✗ Failed "${item.title}": ${err.message}`)
      failed.push({ title: item.title, error: err.message })
    }
  }

  console.log('\n── Summary ──────────────────────────')
  console.log(`Created: ${created.length}`)
  console.log(`Skipped: ${skipped.length}`)
  console.log(`Failed:  ${failed.length}`)
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.title}: ${f.error}`)
  }

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error('Fatal error:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})

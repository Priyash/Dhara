#!/usr/bin/env node
/**
 * Import public-domain / Creative-Commons titles from the Internet Archive
 * (archive.org) into MongoDB — without downloading the video locally.
 *
 * For each item we:
 *   1. Fetch archive.org metadata (title, year, description, license, files).
 *   2. Pick the best MP4 / H.264 file and build its download URL.
 *   3. Create a Bunny Stream video and trigger Bunny's remote *fetch* so Bunny
 *      pulls the file straight from archive.org and transcodes it. No local
 *      download / re-upload of large files.
 *   4. Upload a poster to Cloudinary from archive.org's image service URL.
 *   5. Insert a Content document.
 *
 * Usage:
 *   node scripts/importFromArchive.js <manifest.json> [--dry-run] [--force] [--allow-unlicensed]
 *
 *   --dry-run            Fetch metadata and print what would be imported.
 *                        No Bunny fetch, no Cloudinary upload, no DB write.
 *   --force              Re-import titles that already exist (by title).
 *   --allow-unlicensed   Import items even when no public-domain / CC license
 *                        could be detected. OFF by default on purpose —
 *                        archive.org hosts content under many rights, and an
 *                        unlicensed item may be a copyright risk for a public MVP.
 *
 * Manifest format: see scripts/archive-manifest.example.json
 *   {
 *     "defaults": { "contentLanguage": "Bengali", "isPremium": false },
 *     "items": [
 *       { "archiveId": "night_of_the_living_dead", "type": "Film", "genre": ["Horror"] }
 *     ]
 *   }
 *   archive.org metadata fills title / releaseYear / desc automatically;
 *   any field set on the item or in defaults overrides the auto-filled value.
 *
 *   Series / Serial Drama: give "seasons" instead of a top-level "archiveId",
 *   with one archive.org identifier per episode:
 *     {
 *       "type": "Series", "title": "My Series",
 *       "posterArchiveId": "optional-id-for-poster",
 *       "seasons": [
 *         { "number": 1, "title": "", "episodes": [
 *           { "number": 1, "title": "Ep 1", "archiveId": "ep1_id", "file": "optional.mp4" }
 *         ]}
 *       ]
 *     }
 *   The whole series is skipped if any episode lacks a PD/CC license
 *   (unless --allow-unlicensed). Poster defaults to posterArchiveId, else the
 *   first episode's image.
 *
 * Requires env: BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_CDN_PULL_ZONE,
 *               CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
import '../src/config/env.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
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
const bunnyKey  = process.env.BUNNY_STREAM_API_KEY

const [, , manifestArg, ...flags] = process.argv
const dryRun           = flags.includes('--dry-run')
const force            = flags.includes('--force')
const allowUnlicensed  = flags.includes('--allow-unlicensed')

if (!manifestArg) {
  console.error('Usage: node scripts/importFromArchive.js <manifest.json> [--dry-run] [--force] [--allow-unlicensed]')
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

const cachePath = path.resolve(import.meta.dirname, '.archive-import-cache.json')
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
function saveCache() { if (!dryRun) writeFileSync(cachePath, JSON.stringify(cache, null, 2)) }

function slugify(str) {
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// archive.org marks public-domain / Creative-Commons items via a licenseurl,
// a "public domain" rights string, or membership in known-PD collections.
const PD_COLLECTIONS = new Set(['prelinger', 'feature_films', 'classic_tv', 'publicmovies', 'film_noir'])
function detectLicense(meta) {
  const licenseUrl = meta.licenseurl || ''
  const rights     = String(meta.rights || meta.possible_copyright_status || '').toLowerCase()
  const collections = Array.isArray(meta.collection) ? meta.collection : [meta.collection].filter(Boolean)

  if (/creativecommons\.org|spdx\.org/i.test(licenseUrl)) return { ok: true, label: licenseUrl }
  if (rights.includes('public domain') || rights.includes('publicdomain')) return { ok: true, label: 'public domain' }
  if (collections.some(c => PD_COLLECTIONS.has(c))) return { ok: true, label: `collection:${collections.find(c => PD_COLLECTIONS.has(c))}` }
  return { ok: false, label: licenseUrl || rights || 'unknown' }
}

// Prefer a real .mp4 / H.264 file, largest first (best quality available).
function pickVideoFile(files) {
  const candidates = files.filter(f => {
    const name = (f.name || '').toLowerCase()
    const fmt  = (f.format || '').toLowerCase()
    return name.endsWith('.mp4') || fmt.includes('h.264') || fmt.includes('mpeg4')
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
  return candidates[0]
}

async function fetchArchiveMetadata(id) {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`archive.org metadata HTTP ${res.status}`)
  const data = await res.json()
  if (!data || !data.metadata) throw new Error('archive.org returned no metadata (bad identifier?)')
  return data
}

async function bunnyFetchVideo(remoteUrl, title) {
  if (cache[remoteUrl]) return cache[remoteUrl]
  if (!libraryId || !bunnyKey) throw new Error('Missing BUNNY_STREAM_LIBRARY_ID or BUNNY_STREAM_API_KEY in env.')

  const createRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
    method: 'POST',
    headers: { AccessKey: bunnyKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!createRes.ok) throw new Error(`Bunny create video failed: ${await createRes.text()}`)
  const { guid } = await createRes.json()

  // Tell Bunny to pull the file from archive.org itself (no local transfer).
  const fetchRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${guid}/fetch`, {
    method: 'POST',
    headers: { AccessKey: bunnyKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: remoteUrl }),
  })
  if (!fetchRes.ok) throw new Error(`Bunny fetch failed: ${await fetchRes.text()}`)

  cache[remoteUrl] = guid
  saveCache()
  return guid
}

async function uploadPosterFromUrl(remoteUrl, slug) {
  const cacheK = `poster:${slug}`
  if (cache[cacheK]) return cache[cacheK]
  const result = await cloudinary.uploader.upload(remoteUrl, {
    folder: 'dhara/posters',
    public_id: slug,
    overwrite: true,
    transformation: [{ width: 800, height: 1200, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' }],
  })
  cache[cacheK] = result.secure_url
  saveCache()
  return result.secure_url
}

const EPISODIC_TYPES = new Set(['Series', 'Serial Drama'])
function isEpisodic(item) {
  return EPISODIC_TYPES.has(item.type) || Array.isArray(item.seasons)
}

// Resolve one archive.org identifier to its metadata, license, and best video URL.
// `file` optionally pins a specific filename within the item (else best MP4 wins).
async function resolveArchiveItem(id, file) {
  const archive = await fetchArchiveMetadata(id)
  const license = detectLicense(archive.metadata)
  let videoFile = null
  if (file) {
    videoFile = (archive.files || []).find(f => f.name === file)
    if (!videoFile) throw new Error(`file "${file}" not found in archive item "${id}"`)
  } else {
    videoFile = pickVideoFile(archive.files || [])
    if (!videoFile) throw new Error(`no MP4 / H.264 file found in archive item "${id}"`)
  }
  const videoUrl = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(videoFile.name)}`
  return { archive, license, videoUrl }
}

function metaDesc(meta) {
  return (Array.isArray(meta.description) ? meta.description[0] : meta.description) || ''
}
function metaYear(meta) {
  return meta.year ? Number(String(meta.year).slice(0, 4)) : undefined
}

// Single-video Film / Documentary / Live.
async function buildFilmDoc(item, archive, videoUrl) {
  const meta  = archive.metadata
  const id    = item.archiveId
  const slug  = slugify(item.title || meta.title || id)
  const title = item.title || meta.title || id

  const doc = {
    ...defaults,
    type: 'Film',
    title,
    desc: item.desc || metaDesc(meta),
    releaseYear: item.releaseYear || metaYear(meta),
    ...item,
  }
  delete doc.archiveId

  if (!dryRun) {
    doc.bunnyVideoId = await bunnyFetchVideo(videoUrl, title)
    doc.posterUrl    = await uploadPosterFromUrl(`https://archive.org/services/img/${encodeURIComponent(id)}`, slug)
  }

  doc.isPublished      = doc.isPublished ?? true
  doc.submissionStatus = doc.submissionStatus || 'approved'
  return doc
}

// Series / Serial Drama: each episode references its own archive.org identifier.
// Returns { doc, licenses } so the caller can gate the whole series on license.
async function buildEpisodicDoc(item) {
  const title = item.title || item.archiveId || 'Untitled Series'
  const slug  = slugify(title)
  const seasons = item.seasons || []
  if (seasons.length === 0) throw new Error(`episodic item "${title}" has no "seasons"`)

  const licenses = []
  let firstEpisodeId = null
  const builtSeasons = []

  for (const season of seasons) {
    const episodes = []
    for (const ep of season.episodes || []) {
      if (!ep.archiveId) throw new Error(`S${season.number}E${ep.number} of "${title}" missing "archiveId"`)
      firstEpisodeId = firstEpisodeId || ep.archiveId
      const { license, videoUrl } = await resolveArchiveItem(ep.archiveId, ep.file)
      licenses.push({ id: ep.archiveId, license })

      const episode = {
        number:   Number(ep.number),
        title:    String(ep.title || `Episode ${ep.number}`),
        desc:     String(ep.desc || ''),
        duration: String(ep.duration || ''),
        bunnyVideoId: '',
        _videoUrl: videoUrl,  // stripped before persisting; used for the Bunny fetch
      }
      episodes.push(episode)
    }
    builtSeasons.push({ number: Number(season.number), title: String(season.title || ''), episodes })
  }

  // Fetch each episode's video into Bunny (skipped on dry run).
  if (!dryRun) {
    for (const season of builtSeasons) {
      for (const ep of season.episodes) {
        ep.bunnyVideoId = await bunnyFetchVideo(ep._videoUrl, `${title} S${season.number}E${ep.number}`)
      }
    }
  }
  for (const season of builtSeasons) for (const ep of season.episodes) delete ep._videoUrl

  const posterId = item.posterArchiveId || firstEpisodeId
  const doc = {
    ...defaults,
    type: EPISODIC_TYPES.has(item.type) ? item.type : 'Series',
    title,
    desc: item.desc || '',
    releaseYear: item.releaseYear,
    ...item,
    seasons: builtSeasons,
  }
  delete doc.archiveId
  delete doc.posterArchiveId

  if (!dryRun && !doc.posterUrl && posterId) {
    doc.posterUrl = await uploadPosterFromUrl(`https://archive.org/services/img/${encodeURIComponent(posterId)}`, slug)
  }

  doc.isPublished      = doc.isPublished ?? true
  doc.submissionStatus = doc.submissionStatus || 'approved'
  return { doc, licenses }
}

async function main() {
  console.log(`Importing ${items.length} archive.org item(s). ${dryRun ? '[dry run]' : ''}`)
  if (!dryRun) await connectMongoDB()

  const created = [], skipped = [], failed = []

  for (const item of items) {
    const label = item.title || item.archiveId || '(unnamed)'
    try {
      const episodic = isEpisodic(item)

      // Resolve metadata + license first (cheap, no uploads), so we can run the
      // license gate and duplicate check before any Bunny / Cloudinary work.
      let title, filmArchive, filmVideoUrl, filmLicense
      if (episodic) {
        title = item.title || item.archiveId || 'Untitled Series'
      } else {
        const id = item.archiveId
        if (!id) throw new Error('item missing "archiveId"')
        const resolved = await resolveArchiveItem(id, item.file)
        filmArchive = resolved.archive; filmVideoUrl = resolved.videoUrl; filmLicense = resolved.license
        if (!filmLicense.ok && !allowUnlicensed) {
          console.warn(`⏭  "${filmArchive.metadata.title || id}" — no PD/CC license detected (${filmLicense.label}). Skipped. Pass --allow-unlicensed to override.`)
          skipped.push(label); continue
        }
        title = item.title || filmArchive.metadata.title || id
      }

      if (!force && !dryRun) {
        const existing = await Content.findOne({ title }).lean()
        if (existing) { console.log(`⏭  "${title}" already exists. Skipped.`); skipped.push(label); continue }
      }

      let doc
      if (episodic) {
        const built = await buildEpisodicDoc(item)
        // Gate the whole series: every episode must clear the license check.
        const unlicensed = built.licenses.filter(l => !l.license.ok)
        if (unlicensed.length && !allowUnlicensed) {
          console.warn(`⏭  "${title}" — ${unlicensed.length} episode(s) with no PD/CC license (${unlicensed.map(u => u.id).join(', ')}). Skipped. Pass --allow-unlicensed to override.`)
          skipped.push(label); continue
        }
        doc = built.doc
        const epCount = doc.seasons.reduce((n, s) => n + s.episodes.length, 0)
        console.log(`\n→ "${title}" (${doc.type}) — ${doc.seasons.length} season(s), ${epCount} episode(s)`)
      } else {
        doc = await buildFilmDoc(item, filmArchive, filmVideoUrl)
        console.log(`\n→ "${title}" (${doc.releaseYear || '?'}) — license: ${filmLicense.label}`)
        console.log(`  video: ${filmVideoUrl}`)
      }

      if (dryRun) { created.push(title); continue }

      const result = await Content.create(doc)
      console.log(`  ✓ Created Content ${result._id}`)
      created.push(title)
    } catch (err) {
      console.error(`  ✗ Failed "${label}": ${err.message}`)
      failed.push({ id: label, error: err.message })
    }
  }

  console.log('\n── Summary ──────────────────────────')
  console.log(`${dryRun ? 'Would import' : 'Created'}: ${created.length}`)
  console.log(`Skipped: ${skipped.length}`)
  console.log(`Failed:  ${failed.length}`)
  for (const f of failed) console.log(`  - ${f.id}: ${f.error}`)

  if (!dryRun) await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error('Fatal error:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})

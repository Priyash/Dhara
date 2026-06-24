/**
 * Internet Archive (archive.org) import helpers shared by the admin routes.
 *
 * Pulls public-domain / Creative-Commons titles into the catalog without
 * downloading video locally: Bunny Stream fetches the file straight from
 * archive.org, and Cloudinary pulls the poster from archive.org's image API.
 */
import { v2 as cloudinary } from 'cloudinary'
import { bunnyRequest } from './bunnyUpload.js'

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Collections that are public-domain / openly licensed film libraries.
export const DEFAULT_PD_COLLECTIONS = ['feature_films', 'prelinger', 'classic_tv', 'publicmovies', 'film_noir']

export function slugify(str) {
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/** Classify an archive.org metadata object's licensing. */
export function detectLicense(meta = {}) {
  const licenseUrl  = meta.licenseurl || ''
  const rights      = String(meta.rights || meta.possible_copyright_status || '').toLowerCase()
  const collections = Array.isArray(meta.collection) ? meta.collection : [meta.collection].filter(Boolean)
  const pd = new Set(DEFAULT_PD_COLLECTIONS)

  if (/creativecommons\.org|spdx\.org/i.test(licenseUrl)) return { ok: true, label: licenseUrl }
  if (rights.includes('public domain') || rights.includes('publicdomain')) return { ok: true, label: 'public domain' }
  const inPd = collections.find(c => pd.has(c))
  if (inPd) return { ok: true, label: `collection:${inPd}` }
  return { ok: false, label: licenseUrl || rights || 'unknown' }
}

/** Pick the best MP4 / H.264 file (largest = highest quality) from an item's files. */
export function pickVideoFile(files = []) {
  const candidates = files.filter(f => {
    const name = (f.name || '').toLowerCase()
    const fmt  = (f.format || '').toLowerCase()
    return name.endsWith('.mp4') || fmt.includes('h.264') || fmt.includes('mpeg4')
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
  return candidates[0]
}

export async function fetchArchiveMetadata(id) {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`archive.org metadata HTTP ${res.status}`)
  const data = await res.json()
  if (!data || !data.metadata) throw new Error('archive.org returned no metadata (bad identifier?)')
  return data
}

export function archiveVideoUrl(id, fileName) {
  return `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`
}

/**
 * Search archive.org for importable titles. Returns lightweight rows including
 * a `license` classification so the UI can badge each result, plus the total
 * match count so callers can paginate (archive.org's own `page`/`rows` params).
 */
export async function searchArchive({ language = 'Bengali', query = '', collections, rows = 40, page = 1 } = {}) {
  const clauses = ['mediatype:movies']
  if (language) clauses.push(`language:(${language})`)
  // Only narrow by collection when the caller explicitly asks — the curated
  // DEFAULT_PD_COLLECTIONS list is almost entirely English-language American
  // film libraries, so AND-ing it in by default returns zero results for
  // most other languages (e.g. Bengali). detectLicense() below still flags
  // unlicensed results so the UI can leave them unchecked instead.
  if (Array.isArray(collections) && collections.length) {
    clauses.push(`(${collections.map(c => `collection:${c}`).join(' OR ')})`)
  }
  if (query) clauses.push(`(${query})`)

  const params = new URLSearchParams({
    q: clauses.join(' AND '),
    rows: String(rows),
    page: String(page),
    output: 'json',
  })
  for (const f of ['identifier', 'title', 'year', 'licenseurl', 'rights', 'collection']) params.append('fl[]', f)

  const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`)
  if (!res.ok) throw new Error(`archive.org search HTTP ${res.status}`)
  const json = await res.json()
  const docs = json?.response?.docs || []
  const total = Number(json?.response?.numFound ?? docs.length)

  const items = docs.map(d => {
    const license = detectLicense(d)
    return {
      archiveId:   d.identifier,
      title:       Array.isArray(d.title) ? d.title[0] : d.title,
      year:        d.year ? Number(String(d.year).slice(0, 4)) : null,
      licenseLabel: license.label,
      licensed:    license.ok,
      detailUrl:   `https://archive.org/details/${d.identifier}`,
      thumbUrl:    `https://archive.org/services/img/${d.identifier}`,
    }
  })

  return { items, total, page: Number(page), rows: Number(rows) }
}

/** Create a Bunny video and have Bunny fetch the file from a remote URL. Returns the GUID. */
export async function bunnyFetchFromUrl(remoteUrl, title, bunnyCollectionId = '') {
  const created = await bunnyRequest(`/library/${libraryId}/videos`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(bunnyCollectionId ? { title, collectionId: bunnyCollectionId } : { title }),
  })
  const guid = created?.guid
  if (!guid) throw new Error('Bunny did not return a video ID.')

  await bunnyRequest(`/library/${libraryId}/videos/${guid}/fetch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: remoteUrl }),
  })
  return guid
}

export async function uploadPosterFromUrl(remoteUrl, slug) {
  const result = await cloudinary.uploader.upload(remoteUrl, {
    folder: 'dhara/posters',
    public_id: slug,
    overwrite: true,
    transformation: [{ width: 800, height: 1200, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' }],
  })
  return result.secure_url
}

const EPISODIC_TYPES = new Set(['Series', 'Serial Drama'])

/**
 * Find-or-create the dedicated "Internet Archive" collection that imported
 * titles are grouped under. Creates a matching Bunny Stream collection the
 * first time so UploadJob records (which require a collection) have one.
 */
export async function ensureArchiveCollection({ StreamCollectionModel }) {
  const slug = 'internet-archive'
  const existing = await StreamCollectionModel.findOne({ slug }).lean()
  if (existing?.bunnyCollectionId) return existing

  const created = await bunnyRequest(`/library/${libraryId}/collections`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: 'Internet Archive' }),
  })
  const bunnyCollectionId = String(created?.guid || '').trim()
  if (!bunnyCollectionId) throw new Error('Bunny did not return a collection GUID')

  return StreamCollectionModel.findOneAndUpdate(
    { slug },
    { $set: { name: 'Internet Archive', slug, bunnyCollectionId, isActive: true, description: 'Public-domain titles imported from archive.org' } },
    { upsert: true, new: true }
  ).lean()
}

/**
 * Queue one archive.org item for import. Creates the Content doc (unpublished,
 * video not yet linked), triggers Bunny to fetch each video from archive.org,
 * and records an UploadJob per video so the existing job-sync pipeline tracks
 * transcoding, links the bunnyVideoId, and guards publishing until ready.
 *
 * Models are injected to avoid circular imports. Returns
 * { created | skipped, title, ... } and throws only on hard failures.
 */
export async function queueArchiveImport(item, { ContentModel, UploadJobModel, collection, allowUnlicensed = false, createdByEmail = '' }) {
  const episodic = EPISODIC_TYPES.has(item.type) || Array.isArray(item.seasons)
  return episodic
    ? queueEpisodic(item, { ContentModel, UploadJobModel, collection, allowUnlicensed, createdByEmail })
    : queueFilm(item, { ContentModel, UploadJobModel, collection, allowUnlicensed, createdByEmail })
}

function jobBase(collection, createdByEmail) {
  return {
    createdByEmail:    createdByEmail || 'system@archive-import',
    collectionId:      collection._id,
    collectionName:    collection.name,
    bunnyCollectionId: collection.bunnyCollectionId,
    status:            'processing',
    progress:          50,
    note:              'Bunny is fetching the file from archive.org…',
  }
}

async function queueFilm(item, { ContentModel, UploadJobModel, collection, allowUnlicensed, createdByEmail }) {
  const id = item.archiveId
  if (!id) throw new Error('item missing "archiveId"')

  const archive = await fetchArchiveMetadata(id)
  const license = detectLicense(archive.metadata)
  const meta    = archive.metadata
  const title   = item.title || meta.title || id
  if (!license.ok && !allowUnlicensed) {
    return { skipped: true, reason: `no PD/CC license (${license.label})`, title }
  }
  if (await ContentModel.findOne({ title }).lean()) return { skipped: true, reason: 'already exists', title }

  const videoFile = pickVideoFile(archive.files || [])
  if (!videoFile) throw new Error('no MP4 / H.264 file found in this archive.org item')

  const slug = slugify(title)
  let posterUrl = ''
  try { posterUrl = await uploadPosterFromUrl(`https://archive.org/services/img/${encodeURIComponent(id)}`, slug) }
  catch { /* poster is best-effort */ }

  // Content created without bunnyVideoId — the job-sync links it once ready.
  const doc = await ContentModel.create({
    type:        'Film',
    genre:       Array.isArray(item.genre) ? item.genre : [],
    isPremium:   Boolean(item.isPremium),
    ...item,
    title,
    desc:        item.desc || (Array.isArray(meta.description) ? meta.description[0] : meta.description) || '',
    releaseYear: item.releaseYear || (meta.year ? Number(String(meta.year).slice(0, 4)) : null),
    posterUrl,
    bunnyVideoId:     '',
    isPublished:      false,
    submissionStatus: 'approved',
    archiveId:        undefined,
  })

  const videoUrl = archiveVideoUrl(id, videoFile.name)
  const bunnyVideoId = await bunnyFetchFromUrl(videoUrl, title, collection.bunnyCollectionId)
  await UploadJobModel.create({
    ...jobBase(collection, createdByEmail),
    title,
    contentId: doc._id,
    bunnyVideoId,
    fileName:  videoFile.name,
    sourceUrl: videoUrl,
  })

  return { created: true, id: doc._id, title, jobs: 1 }
}

async function queueEpisodic(item, { ContentModel, UploadJobModel, collection, allowUnlicensed, createdByEmail }) {
  const title = item.title || item.archiveId || 'Untitled Series'
  const seasons = item.seasons || []
  if (seasons.length === 0) throw new Error(`episodic item "${title}" has no "seasons"`)
  if (await ContentModel.findOne({ title }).lean()) return { skipped: true, reason: 'already exists', title }

  // Resolve + license-gate every episode before creating anything.
  const resolved = []
  let firstEpisodeId = null
  for (const season of seasons) {
    for (const ep of season.episodes || []) {
      if (!ep.archiveId) throw new Error(`S${season.number}E${ep.number} missing "archiveId"`)
      firstEpisodeId = firstEpisodeId || ep.archiveId
      const archive = await fetchArchiveMetadata(ep.archiveId)
      const license = detectLicense(archive.metadata)
      const videoFile = pickVideoFile(archive.files || [])
      if (!videoFile) throw new Error(`no MP4 found for episode "${ep.archiveId}"`)
      resolved.push({ season, ep, license, videoUrl: archiveVideoUrl(ep.archiveId, videoFile.name) })
    }
  }
  const unlicensed = resolved.filter(r => !r.license.ok)
  if (unlicensed.length && !allowUnlicensed) {
    return { skipped: true, reason: `${unlicensed.length} episode(s) without PD/CC license`, title }
  }

  // Build season/episode shells with empty bunnyVideoId — job-sync fills them in.
  const seasonMap = new Map()
  for (const r of resolved) {
    if (!seasonMap.has(r.season.number)) {
      seasonMap.set(r.season.number, { number: Number(r.season.number), title: String(r.season.title || ''), episodes: [] })
    }
    seasonMap.get(r.season.number).episodes.push({
      number:   Number(r.ep.number),
      title:    String(r.ep.title || `Episode ${r.ep.number}`),
      desc:     String(r.ep.desc || ''),
      duration: String(r.ep.duration || ''),
      bunnyVideoId: '',
    })
  }

  let posterUrl = item.posterUrl || ''
  const posterId = item.posterArchiveId || firstEpisodeId
  if (!posterUrl && posterId) {
    try { posterUrl = await uploadPosterFromUrl(`https://archive.org/services/img/${encodeURIComponent(posterId)}`, slugify(title)) }
    catch { /* best-effort */ }
  }

  const doc = await ContentModel.create({
    type:      EPISODIC_TYPES.has(item.type) ? item.type : 'Series',
    genre:     Array.isArray(item.genre) ? item.genre : [],
    isPremium: Boolean(item.isPremium),
    ...item,
    title,
    desc:      item.desc || '',
    posterUrl,
    seasons:   [...seasonMap.values()].sort((a, b) => a.number - b.number),
    isPublished:      false,
    submissionStatus: 'approved',
    archiveId:        undefined,
    posterArchiveId:  undefined,
  })

  // One Bunny fetch + UploadJob per episode; job-sync links each when ready.
  for (const r of resolved) {
    const bunnyVideoId = await bunnyFetchFromUrl(r.videoUrl, `${title} S${r.season.number}E${r.ep.number}`, collection.bunnyCollectionId)
    await UploadJobModel.create({
      ...jobBase(collection, createdByEmail),
      title:           `${title} S${r.season.number}E${r.ep.number}`,
      contentId:       doc._id,
      seasonNumber:    Number(r.season.number),
      episodeNumber:   Number(r.ep.number),
      episodeTitle:    String(r.ep.title || `Episode ${r.ep.number}`),
      episodeDuration: String(r.ep.duration || ''),
      bunnyVideoId,
      sourceUrl:       r.videoUrl,
    })
  }

  return { created: true, id: doc._id, title, jobs: resolved.length }
}

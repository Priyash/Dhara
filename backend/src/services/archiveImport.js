/**
 * Internet Archive (archive.org) import helpers shared by the admin routes.
 *
 * Pulls public-domain / Creative-Commons titles into the catalog without
 * downloading video locally: Bunny Stream fetches the file straight from
 * archive.org, and Cloudinary pulls the poster from archive.org's image API.
 */
import { v2 as cloudinary } from 'cloudinary'
import { bunnyRequest } from './bunnyUpload.js'
import { REEL_MAX_DURATION_SECS } from '../models/Reel.js'

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Collections that are public-domain / openly licensed film libraries.
export const DEFAULT_PD_COLLECTIONS = ['feature_films', 'prelinger', 'classic_tv', 'publicmovies', 'film_noir']

// Collections that indicate a catalog `type` other than the 'Film' default.
const TYPE_BY_COLLECTION = {
  classic_tv:           'Series',
  television:           'Series',
  newsandpublicaffairs: 'Documentary',
  prelinger:            'Documentary',
}

export function slugify(str) {
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function normalizeCollections(meta = {}) {
  return Array.isArray(meta.collection) ? meta.collection : [meta.collection].filter(Boolean)
}

/** Classify an archive.org metadata object's licensing. */
export function detectLicense(meta = {}) {
  const licenseUrl  = meta.licenseurl || ''
  const rights      = String(meta.rights || meta.possible_copyright_status || '').toLowerCase()
  const collections = normalizeCollections(meta)
  const pd = new Set(DEFAULT_PD_COLLECTIONS)

  if (/creativecommons\.org|spdx\.org/i.test(licenseUrl)) return { ok: true, label: licenseUrl }
  if (rights.includes('public domain') || rights.includes('publicdomain')) return { ok: true, label: 'public domain' }
  const inPd = collections.find(c => pd.has(c))
  if (inPd) return { ok: true, label: `collection:${inPd}` }
  return { ok: false, label: licenseUrl || rights || 'unknown' }
}

/** Infer a catalog `type` from an archive.org item's collection tags. Defaults to 'Film'. */
export function inferType(meta = {}) {
  const collections = normalizeCollections(meta)
  for (const c of collections) {
    if (TYPE_BY_COLLECTION[c]) return TYPE_BY_COLLECTION[c]
  }
  return 'Film'
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
      type:        inferType(d),
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

// Catalog-metadata fields an import item may carry through to the Content doc.
// Everything else — _id, status flags (isPublished/submissionStatus/isDeleted),
// counters (viewCount/likeCount/…), bunnyVideoId, searchKey, archiveId — is set
// explicitly below or must NEVER come from caller-supplied item data. Spreading
// a raw `...item` risked exactly that.
const CONTENT_PASSTHROUGH = [
  'subtitle', 'duration', 'badge', 'cast', 'director',
  'contentLanguage', 'certification', 'contentWarnings', 'moodTags', 'backdropUrl', 'rating',
]

/** Picks only the allow-listed keys from an object (skips undefined values). */
export function pickFields(obj = {}, allowed = []) {
  const out = {}
  for (const k of allowed) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

/** Resolve a sane integer release year from the import item or archive.org metadata, or null. */
export function parseReleaseYear(item = {}, meta = {}) {
  if (item.releaseYear) return Number(item.releaseYear) || null
  const y = Number(String(meta.year ?? '').slice(0, 4))
  return Number.isFinite(y) && y > 0 ? y : null
}

/** Parse archive.org's per-file `length` field — either a plain-seconds string or "HH:MM:SS" — into integer seconds. Returns null if unparseable. */
export function parseDurationSecs(length) {
  if (length == null || length === '') return null
  const str = String(length).trim()
  if (/^\d+(\.\d+)?$/.test(str)) return Math.round(Number(str))
  const parts = str.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

const ARCHIVE_REEL_CREATOR_UID = 'system:archive-import'

/**
 * Find-or-create the synthetic "system" User that owns archive-imported Reels.
 * Reel.creatorId is required, and no admin route creates Reels directly, so
 * archive-sourced reels need a stable, real User document to reference.
 * Atomic upsert (mirrors ensureArchiveCollection) avoids a race against
 * User's unique firebaseUid index when multiple import tasks run concurrently.
 */
export async function ensureArchiveReelCreator({ UserModel }) {
  return UserModel.findOneAndUpdate(
    { firebaseUid: ARCHIVE_REEL_CREATOR_UID },
    {
      $setOnInsert: {
        firebaseUid: ARCHIVE_REEL_CREATOR_UID,
        email:       'archive-import@dhara.system',
        displayName: 'Internet Archive',
        isCreator:   true,
        creatorStatus: 'approved',
      },
    },
    { upsert: true, new: true }
  )
}

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
export async function queueArchiveImport(item, { ContentModel, UploadJobModel, ReelModel, collection, allowUnlicensed = false, createdByEmail = '', reelCreatorId = null }) {
  if (item.mediaKind === 'reel') {
    return queueReel(item, { ReelModel, UploadJobModel, collection, allowUnlicensed, createdByEmail, creatorId: reelCreatorId })
  }
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

  // Already in the catalog and not soft-deleted — don't push it to the CDN again.
  if (await ContentModel.findOne({ archiveId: id, isDeleted: { $ne: true } }).lean()) {
    return { skipped: true, reason: 'already imported', title: item.title || id }
  }

  const archive = await fetchArchiveMetadata(id)
  const license = detectLicense(archive.metadata)
  const meta    = archive.metadata
  const title   = item.title || meta.title || id
  if (!license.ok && !allowUnlicensed) {
    return { skipped: true, reason: `no PD/CC license (${license.label})`, title }
  }
  // Title collision with a *live* doc only — a same-titled doc that was soft-deleted
  // (e.g. freed by cdnReconcile, or manually removed) must not block reimport.
  if (await ContentModel.findOne({ title, isDeleted: { $ne: true } }).lean()) {
    return { skipped: true, reason: 'already exists', title }
  }

  const videoFile = pickVideoFile(archive.files || [])
  if (!videoFile) throw new Error('no MP4 / H.264 file found in this archive.org item')

  const slug = slugify(title)
  let posterUrl = ''
  try { posterUrl = await uploadPosterFromUrl(`https://archive.org/services/img/${encodeURIComponent(id)}`, slug) }
  catch { /* poster is best-effort */ }

  // Content created WITHOUT bunnyVideoId — the job-sync links it once ready.
  // Must be omitted (not ''): the unique index on bunnyVideoId is sparse, which
  // skips a MISSING field but still indexes an empty string — so writing '' here
  // makes the 2nd+ pending import collide with E11000 (duplicate key) until the
  // first one's real GUID is backfilled.
  const doc = await ContentModel.create({
    ...pickFields(item, CONTENT_PASSTHROUGH),
    type:        item.type === 'Documentary' ? 'Documentary' : 'Film',
    genre:       Array.isArray(item.genre) ? item.genre : [],
    isPremium:   Boolean(item.isPremium),
    title,
    desc:        item.desc || (Array.isArray(meta.description) ? meta.description[0] : meta.description) || '',
    releaseYear: parseReleaseYear(item, meta),
    posterUrl,
    isPublished:      false,
    submissionStatus: 'approved',
    archiveId:        id,
  })

  // If the CDN handoff fails, roll the Content doc back. Otherwise it lingers as
  // a videoless orphan that the dedup check treats as "already imported" — so the
  // worker's retry would skip it forever instead of re-importing cleanly.
  try {
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
  } catch (err) {
    await ContentModel.deleteOne({ _id: doc._id }).catch(() => {})
    throw err
  }

  return { created: true, id: doc._id, title, jobs: 1 }
}

async function queueEpisodic(item, { ContentModel, UploadJobModel, collection, allowUnlicensed, createdByEmail }) {
  const title = item.title || item.archiveId || 'Untitled Series'
  // A single archive.org item typed as a series with no companion manifest
  // (e.g. one classic_tv result with no season/episode breakdown supplied) —
  // land it as Season 1, Episode 1 instead of requiring a hand-built seasons array.
  const seasons = item.seasons?.length
    ? item.seasons
    : (item.archiveId ? [{ number: 1, episodes: [{ number: 1, title: item.title || '', archiveId: item.archiveId }] }] : [])
  if (seasons.length === 0) throw new Error(`episodic item "${title}" has no "seasons"`)

  // Already in the catalog and not soft-deleted — don't push it to the CDN again.
  if (item.archiveId && await ContentModel.findOne({ archiveId: item.archiveId, isDeleted: { $ne: true } }).lean()) {
    return { skipped: true, reason: 'already imported', title }
  }
  // Title collision with a *live* doc only — see comment in queueFilm above.
  if (await ContentModel.findOne({ title, isDeleted: { $ne: true } }).lean()) {
    return { skipped: true, reason: 'already exists', title }
  }

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
    ...pickFields(item, CONTENT_PASSTHROUGH),
    type:      EPISODIC_TYPES.has(item.type) ? item.type : 'Series',
    genre:     Array.isArray(item.genre) ? item.genre : [],
    isPremium: Boolean(item.isPremium),
    title,
    desc:      item.desc || '',
    releaseYear: parseReleaseYear(item, {}),
    posterUrl,
    seasons:   [...seasonMap.values()].sort((a, b) => a.number - b.number),
    isPublished:      false,
    submissionStatus: 'approved',
    archiveId:        item.archiveId || null,
  })

  // One Bunny fetch + UploadJob per episode; job-sync links each when ready.
  // Roll back the Content doc AND any jobs already created if a mid-loop fetch
  // fails — otherwise a partial series orphans the title (dedup would then skip
  // every retry as "already imported").
  try {
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
  } catch (err) {
    await UploadJobModel.deleteMany({ contentId: doc._id }).catch(() => {})
    await ContentModel.deleteOne({ _id: doc._id }).catch(() => {})
    throw err
  }

  return { created: true, id: doc._id, title, jobs: resolved.length }
}

/**
 * Queue one archive.org item as a short-form Reel. Mirrors queueFilm but
 * targets the Reel collection/Bunny "dhara-reels" collection instead of
 * Content/"internet-archive", so archive-sourced reels land in the exact
 * same feed as creator-uploaded ones. Requires `creatorId` (the synthetic
 * system creator from ensureArchiveReelCreator) since Reel.creatorId is
 * required.
 */
async function queueReel(item, { ReelModel, UploadJobModel, collection, allowUnlicensed, createdByEmail, creatorId }) {
  const id = item.archiveId
  if (!id) throw new Error('item missing "archiveId"')
  if (!creatorId) throw new Error('queueReel requires a creatorId')

  // Already in the catalog (as a reel) and not soft-deleted — don't push it to the CDN again.
  if (await ReelModel.findOne({ archiveId: id, isDeleted: { $ne: true } }).lean()) {
    return { skipped: true, reason: 'already imported', title: item.title || id }
  }

  const archive = await fetchArchiveMetadata(id)
  const license = detectLicense(archive.metadata)
  const meta    = archive.metadata
  const title   = item.title || meta.title || id
  if (!license.ok && !allowUnlicensed) {
    return { skipped: true, reason: `no PD/CC license (${license.label})`, title }
  }

  const videoFile = pickVideoFile(archive.files || [])
  if (!videoFile) return { skipped: true, reason: 'no MP4 / H.264 file found', title }

  const durationSecs = parseDurationSecs(videoFile.length)
  if (durationSecs == null) {
    return { skipped: true, reason: 'duration unknown — cannot confirm it fits the reel limit', title }
  }
  if (durationSecs > REEL_MAX_DURATION_SECS) {
    return { skipped: true, reason: `clip is ${durationSecs}s — exceeds the ${REEL_MAX_DURATION_SECS}s reel limit`, title }
  }

  // Reel created WITHOUT bunnyVideoId — the job-sync links it once ready.
  // Omit it (not ''): Reel's bunnyVideoId unique index is sparse, which indexes
  // an empty string but skips a missing field — writing '' collides the 2nd+
  // pending import with E11000 (same root cause as the Film import).
  const doc = await ReelModel.create({
    creatorId,
    title,
    description:      item.desc || (Array.isArray(meta.description) ? meta.description[0] : meta.description) || '',
    durationSecs,
    archiveId:         id,
    isPublished:       false,
    submissionStatus:  'pending',
  })

  // Roll the Reel doc back if the CDN handoff fails — same orphan/dedup-skip
  // hazard as the Film path.
  try {
    const videoUrl = archiveVideoUrl(id, videoFile.name)
    const bunnyVideoId = await bunnyFetchFromUrl(videoUrl, title, collection.bunnyCollectionId)
    await UploadJobModel.create({
      ...jobBase(collection, createdByEmail),
      title,
      reelId:    doc._id,
      bunnyVideoId,
      fileName:  videoFile.name,
      sourceUrl: videoUrl,
    })
  } catch (err) {
    await ReelModel.deleteOne({ _id: doc._id }).catch(() => {})
    throw err
  }

  return { created: true, id: doc._id, title, jobs: 1 }
}

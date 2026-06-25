import { Router } from 'express'
import { pipeline } from 'stream/promises'
import { createWriteStream, createReadStream, unlink } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Content } from '../models/Content.js'
import { CuratedShelf } from '../models/CuratedShelf.js'
import { StreamCollection } from '../models/StreamCollection.js'
import { AdminAction } from '../models/AdminAction.js'
import { cache } from '../config/cache.js'
import {
  emailCreatorApproved, emailCreatorRejected,
  emailSubmissionApproved, emailSubmissionRejected,
} from '../config/email.js'

// Bust the Browse/Home content cache whenever admin mutates the catalog
function bustContentCache() { cache.deleteByPrefix('/api/content') }
import { UploadJob } from '../models/UploadJob.js'
import { PaymentConfig } from '../models/PaymentConfig.js'
import { Transaction } from '../models/Transaction.js'
import { User } from '../models/User.js'
import { CreatorEarning } from '../models/CreatorEarning.js'
import { CreatorPayout } from '../models/CreatorPayout.js'
import { ViewEvent } from '../models/ViewEvent.js'
import { SearchLog } from '../models/SearchLog.js'
import { Reel, REEL_MAX_DURATION_SECS } from '../models/Reel.js'
import { SUPPORTED_PROVIDERS, getProviderStatus } from '../providers/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { calculateMonthlyEarnings } from '../config/earningsJob.js'

// Hard cap for unpaginated admin list endpoints — prevents an unbounded
// collection scan/response as data grows, without changing the response
// shape for the current frontend (which expects a plain array).
const ADMIN_LIST_CAP = 500

// Escape HTML entities to prevent XSS when admin-supplied text is rendered in emails or UI
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// Fire-and-forget admin audit log — never blocks the response
function logAdminAction(req, action, targetType, targetId, targetLabel, metadata = {}) {
  AdminAction.create({
    adminEmail:  req.user?.email || '',
    adminUid:    req.user?.firebaseUid || '',
    action,
    targetType,
    targetId:    targetId || null,
    targetLabel: targetLabel || '',
    metadata,
  }).catch((err) => console.error('[audit]', err.message))
}

import { bunnyRequest, processUploadJob } from '../services/bunnyUpload.js'
import { searchArchive, bunnyFetchFromUrl } from '../services/archiveImport.js'
import { ArchiveCandidate } from '../models/ArchiveCandidate.js'
import { ArchiveImportTask } from '../models/ArchiveImportTask.js'
import { triggerImportDrain } from '../config/archiveImportWorker.js'

const router = Router()

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID

async function listAllBunnyCollections() {
  const result = await bunnyRequest(`/library/${libraryId}/collections?itemsPerPage=100&page=1`)
  return result?.items || []
}

async function listBunnyVideos({ collectionId = '', search = '' } = {}) {
  const qs = new URLSearchParams({
    page: '1',
    itemsPerPage: '100',
    orderBy: 'date',
  })
  if (collectionId) qs.set('collection', collectionId)
  if (search) qs.set('search', search)

  const result = await bunnyRequest(`/library/${libraryId}/videos?${qs.toString()}`)
  return result?.items || []
}

// Bunny Stream video status codes that indicate a terminal failure
const BUNNY_FAIL_STATUSES = new Set([4, 5, 6])

async function syncProcessingJob(job) {
  if (!job.bunnyVideoId || !['processing', 'uploading', 'queued'].includes(job.status)) return job

  try {
    const video = await bunnyRequest(`/library/${libraryId}/videos/${job.bunnyVideoId}`)
    const bunnyStatus   = Number(video?.status ?? -1)
    const encodeProgress = Number(video?.encodeProgress || 0)

    // Bunny status 4 = Resolution not available, 5 = Upload failed, 6 = Failed
    if (BUNNY_FAIL_STATUSES.has(bunnyStatus)) {
      const errMsg = bunnyStatus === 5 ? 'Bunny upload failed — file may be corrupted or too large.'
                   : bunnyStatus === 4 ? 'Bunny could not encode this resolution.'
                   : 'Bunny encoding failed.'
      const failed = await UploadJob.findByIdAndUpdate(
        job._id,
        { $set: { status: 'failed', progress: 0, error: errMsg } },
        { new: true }
      ).catch(() => null)
      return failed || { ...job, status: 'failed', progress: 0, error: errMsg }
    }

    // Bunny status 3 = Finished; also guard on encodeProgress for safety
    const isReady = bunnyStatus === 3 || encodeProgress >= 100

    const nextStatus = isReady ? 'ready' : 'processing'
    const nextProgress = isReady ? 100 : Math.max(70, Math.min(99, Math.round(70 + encodeProgress * 0.29)))

    const updated = await UploadJob.findByIdAndUpdate(
      job._id,
      {
        $set: {
          status: nextStatus,
          progress: nextProgress,
          note: isReady        ? 'Video is ready to stream.'
             : encodeProgress > 0 ? `Bunny is transcoding… ${encodeProgress}% encoded.`
             :                      'Bunny received the file. Transcoding will begin shortly.',
          error: '',
        },
      },
      { new: true }
    )

    if (isReady && updated?.reelId) {
      // Reel upload — link bunnyVideoId and backfill thumbnailUrl from Bunny if reel has none.
      // Bunny generates thumbnail.jpg for every encoded video; use it as fallback so the
      // grid card always has a poster even when the Cloudinary auto-thumb upload raced.
      const existingReel = await Reel.findById(updated.reelId).select('thumbnailUrl').lean()
      const reelPatch = { bunnyVideoId: updated.bunnyVideoId }
      if (!existingReel?.thumbnailUrl) {
        const pullZone        = process.env.BUNNY_CDN_PULL_ZONE
        const thumbnailFile   = video?.thumbnailFileName || 'thumbnail.jpg'
        if (pullZone) reelPatch.thumbnailUrl = `https://${pullZone}/${updated.bunnyVideoId}/${thumbnailFile}`
      }
      await Reel.findByIdAndUpdate(updated.reelId, { $set: reelPatch })
    } else if (isReady && updated?.contentId) {
      if (updated.episodeNumber) {
        // Series / Serial Drama — link to the correct season→episode.
        // seasonNumber defaults to 1 if the upload form didn't provide one.
        const sNum = updated.seasonNumber ?? 1
        const eNum = updated.episodeNumber
        const linked = await Content.findOneAndUpdate(
          { _id: updated.contentId, 'seasons.number': sNum, 'seasons.episodes.number': eNum },
          { $set: { 'seasons.$[s].episodes.$[e].bunnyVideoId': updated.bunnyVideoId } },
          { arrayFilters: [{ 's.number': sNum }, { 'e.number': eNum }], new: true }
        )
        if (!linked) {
          const hasSeason = await Content.exists({ _id: updated.contentId, 'seasons.number': sNum })
          if (hasSeason) {
            await Content.findOneAndUpdate(
              { _id: updated.contentId, 'seasons.number': sNum },
              {
                $push: {
                  'seasons.$.episodes': {
                    number:       eNum,
                    title:        updated.episodeTitle    || `Episode ${eNum}`,
                    duration:     updated.episodeDuration || '',
                    bunnyVideoId: updated.bunnyVideoId,
                  },
                },
              }
            )
          } else {
            await Content.findByIdAndUpdate(updated.contentId, {
              $push: {
                seasons: {
                  number:   sNum,
                  title:    '',
                  episodes: [{
                    number:       eNum,
                    title:        updated.episodeTitle    || `Episode ${eNum}`,
                    duration:     updated.episodeDuration || '',
                    bunnyVideoId: updated.bunnyVideoId,
                  }],
                },
              },
            })
          }
        }
      } else {
        // Film / Documentary — link to root bunnyVideoId
        await Content.findByIdAndUpdate(updated.contentId, { $set: { bunnyVideoId: updated.bunnyVideoId } })
      }
    }

    return updated || job
  } catch (err) {
    // If Bunny returns 404 the video was deleted from the CDN — mark the job
    // as failed immediately so it stops showing "Transcoding…" in the UI.
    const isGone = /404|not found/i.test(err?.message || '')
    if (isGone) {
      const failed = await UploadJob.findByIdAndUpdate(
        job._id,
        { $set: { status: 'failed', progress: 0, error: 'Video was deleted from Bunny CDN.' } },
        { new: true }
      ).catch(() => null)
      return failed || { ...job, status: 'failed', progress: 0, error: 'Video was deleted from Bunny CDN.' }
    }
    return job
  }
}

router.use(requireAuth, requireAdmin)

router.get('/session', (req, res) => {
  res.json({
    email: req.user?.email || '',
    displayName: req.user?.displayName || '',
    isAdmin: true,
  })
})

/**
 * GET /api/admin/payment-config
 * Returns the active provider, mode, and status of each installed adapter.
 * Secret keys are never exposed — only masked public key hints and booleans.
 */
router.get('/payment-config', async (req, res, next) => {
  try {
    const config = await PaymentConfig.getConfig()
    const backendUrl = process.env.BACKEND_URL || ''
    res.json({
      activeProvider:     config.activeProvider,
      mode:               config.mode,
      supportedProviders: SUPPORTED_PROVIDERS,
      providerStatus:     getProviderStatus(backendUrl),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/payment-config
 * Switches the active provider or toggles between test/live mode.
 * Only accepts fields: activeProvider, mode.
 */
router.patch('/payment-config', async (req, res, next) => {
  try {
    const { activeProvider, mode } = req.body
    const updates = {}

    if (activeProvider !== undefined) {
      if (!SUPPORTED_PROVIDERS.includes(activeProvider)) {
        return res.status(400).json({
          error: `Unsupported provider. Installed: ${SUPPORTED_PROVIDERS.join(', ')}`,
        })
      }
      updates.activeProvider = activeProvider
    }

    if (mode !== undefined) {
      if (!['test', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "test" or "live"' })
      }
      updates.mode = mode
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' })
    }

    const config = await PaymentConfig.findOneAndUpdate(
      { _id: 'singleton' },
      { $set: updates },
      { upsert: true, new: true }
    )

    res.json({
      success:        true,
      activeProvider: config.activeProvider,
      mode:           config.mode,
    })
  } catch (err) {
    next(err)
  }
})

router.get('/collections', async (req, res, next) => {
  try {
    const collections = await StreamCollection.find({ isActive: true }).sort({ name: 1 }).lean()
    res.json(collections)
  } catch (err) {
    next(err)
  }
})

router.get('/bunny/collections', async (req, res, next) => {
  try {
    const collections = await listAllBunnyCollections()
    res.json(collections)
  } catch (err) {
    next(err)
  }
})

router.post('/bunny/collections', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name is required' })

    const created = await bunnyRequest(`/library/${libraryId}/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    const bunnyCollectionId = String(created.guid || '').trim()
    if (!bunnyCollectionId) throw new Error('Bunny did not return a collection GUID')

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const collection = await StreamCollection.findOneAndUpdate(
      { bunnyCollectionId },
      { $set: { name, slug, bunnyCollectionId, isActive: true } },
      { upsert: true, new: true }
    ).lean()

    res.status(201).json(collection)
  } catch (err) {
    next(err)
  }
})

router.post('/bunny/sync-collections', async (req, res, next) => {
  try {
    const bunnyCollections = await listAllBunnyCollections()
    const upserted = []

    for (const col of bunnyCollections) {
      const name = String(col.name || '').trim()
      const bunnyCollectionId = String(col.guid || '').trim()
      if (!name || !bunnyCollectionId) continue

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

      const mapped = await StreamCollection.findOneAndUpdate(
        {
          $or: [{ bunnyCollectionId }, { slug }],
        },
        {
          $set: {
            name,
            slug,
            bunnyCollectionId,
            isActive: true,
          },
        },
        { upsert: true, new: true }
      ).lean()

      upserted.push(mapped)
    }

    res.json({
      success: true,
      imported: upserted.length,
      collections: upserted,
    })
  } catch (err) {
    next(err)
  }
})

router.get('/bunny/videos', async (req, res, next) => {
  try {
    const collectionId = String(req.query.collectionId || '').trim()
    const search = String(req.query.search || '').trim()
    const items = await listBunnyVideos({ collectionId, search })
    res.json(items)
  } catch (err) {
    next(err)
  }
})

router.post('/collections', async (req, res, next) => {
  try {
    const { name, bunnyCollectionId, description = '' } = req.body
    if (!name || !bunnyCollectionId) {
      return res.status(400).json({ error: 'name and bunnyCollectionId are required' })
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const collection = await StreamCollection.findOneAndUpdate(
      { slug },
      {
        $set: {
          name: name.trim(),
          bunnyCollectionId: String(bunnyCollectionId).trim(),
          description,
          isActive: true,
        },
        $setOnInsert: { slug },
      },
      { upsert: true, new: true }
    )

    res.status(201).json(collection)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/admin/import-from-cdn
 * Fetches all videos from Bunny Stream and creates a Content document
 * for each one that doesn't already have a matching bunnyVideoId in MongoDB.
 */
router.post('/import-from-cdn', async (req, res, next) => {
  try {
    const collections = await bunnyRequest(`/library/${libraryId}/collections?page=1&itemsPerPage=100`)
    const allCollections = collections?.items || []

    const existingIds = new Set(
      (await Content.find({ bunnyVideoId: { $exists: true, $ne: '' } }).select('bunnyVideoId').lean())
        .map((c) => c.bunnyVideoId)
    )

    const PALETTES = [
      'linear-gradient(135deg,#0d1f3c 0%,#1a4a8a 100%)',
      'linear-gradient(135deg,#1a0533 0%,#4a0e8f 100%)',
      'linear-gradient(135deg,#2d0a0a 0%,#8b1a1a 100%)',
      'linear-gradient(135deg,#0a2d1a 0%,#1a6b3a 100%)',
      'linear-gradient(135deg,#2d1a00 0%,#8b5e00 100%)',
      'linear-gradient(135deg,#1a0a2d 0%,#5e008b 100%)',
      'linear-gradient(135deg,#001a2d 0%,#006b8b 100%)',
      'linear-gradient(135deg,#2d0a1a 0%,#8b004a 100%)',
    ]

    let imported = 0
    const created = []

    for (const col of allCollections) {
      const videos = await bunnyRequest(
        `/library/${libraryId}/videos?page=1&itemsPerPage=100&collection=${col.guid}`
      )
      for (const video of videos?.items || []) {
        if (existingIds.has(video.guid)) continue

        const durationMins = Math.round((video.length || 0) / 60)
        const palette = PALETTES[imported % PALETTES.length]

        const rawTitle = video.title || 'Untitled'
        const cleanTitle = rawTitle.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mxf)$/i, '').trim() || 'Untitled'
        const content = await Content.create({
          title:        cleanTitle,
          type:         'Film',
          genre:        [],
          rating:       0,
          isPremium:    false,
          isFeatured:   false,
          bunnyVideoId: video.guid,
          palette,
          desc:         '',
          releaseYear:  new Date().getFullYear(),
        })

        existingIds.add(video.guid)
        created.push({ id: content._id, title: content.title })
        imported++
      }
    }

    res.json({ imported, created })
  } catch (err) {
    next(err)
  }
})

// ── Internet Archive import ───────────────────────────────────────────────────
// Search archive.org for public-domain / CC titles to seed the catalog.
router.get('/archive/search', async (req, res, next) => {
  try {
    const { language = 'Bengali', query = '', rows = '40', page = '1' } = req.query
    const collections = req.query.collection
      ? [].concat(req.query.collection)
      : undefined
    const safeRows = Math.min(Number(rows) || 40, 100)
    const safePage = Math.max(Number(page) || 1, 1)
    const { items, total } = await searchArchive({ language, query, collections, rows: safeRows, page: safePage })

    // Flag items already in the catalog so the UI can block re-importing them.
    // A soft-deleted Content/Reel doc doesn't count — once removed (including
    // when the CDN-reconcile job detects a Bunny-side deletion), it's importable again.
    const archiveIds = items.map((i) => i.archiveId).filter(Boolean)
    const [importedContent, importedReels] = archiveIds.length
      ? await Promise.all([
          Content.find({ archiveId: { $in: archiveIds }, isDeleted: { $ne: true } }).select('archiveId').lean(),
          Reel.find({ archiveId: { $in: archiveIds }, isDeleted: { $ne: true } }).select('archiveId').lean(),
        ])
      : [[], []]
    const importedSet = new Set([...importedContent, ...importedReels].map((c) => c.archiveId))
    const results = items.map((i) => ({ ...i, alreadyImported: importedSet.has(i.archiveId) }))

    res.json({ results, total, page: safePage, rows: safeRows })
  } catch (err) {
    next(err)
  }
})

// Queue selected archive.org items for import. Returns immediately (202); the
// batch runs in the background, creating Content docs and UploadJob records so
// the existing job pipeline tracks transcoding and links each video when ready.
router.post('/archive/import', async (req, res, next) => {
  try {
    const { items = [], allowUnlicensed = false } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to import' })
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Import at most 50 items per request' })
    }

    const createdByEmail = req.user?.email || ''
    const batchId = randomUUID()

    // Persist each item as a queue task so the import survives a backend restart.
    await ArchiveImportTask.insertMany(items.map((item) => ({
      batchId,
      item,
      title: item.title || item.archiveId || '',
      allowUnlicensed: Boolean(allowUnlicensed),
      createdByEmail,
      status: 'pending',
    })))

    // Candidate status is updated by the worker once the CDN push actually
    // succeeds or fails (see archiveImportWorker.js) — not here, since at this
    // point nothing has been pushed to Bunny/Cloudinary yet.
    logAdminAction(req, 'archive_import', 'content', null, `${items.length} title(s) queued`, { batchId, queued: items.length })

    res.status(202).json({ queued: items.length, batchId })

    // Kick the worker; if the process dies, startup/interval drain resumes the queue.
    triggerImportDrain()
  } catch (err) {
    next(err)
  }
})

// Per-item status for a batch queued above — lets the UI tell the admin which
// titles actually landed vs. were skipped/failed, instead of a single opaque
// "queued" toast that hides dedup skips and license/duration rejections.
router.get('/archive/import/:batchId', async (req, res, next) => {
  try {
    const tasks = await ArchiveImportTask.find({ batchId: req.params.batchId })
      .select('title status reason error')
      .lean()
    if (tasks.length === 0) return res.status(404).json({ error: 'Batch not found' })
    res.json({ tasks })
  } catch (err) {
    next(err)
  }
})

// List discovered candidates surfaced by the scheduled discovery job.
router.get('/archive/candidates', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'new')
    const candidates = await ArchiveCandidate.find({ status })
      .sort({ discoveredAt: -1 })
      .limit(100)
      .lean()
    res.json({ candidates })
  } catch (err) {
    next(err)
  }
})

// Dismiss a candidate so it stops showing in the review list.
router.patch('/archive/candidates/:id/dismiss', async (req, res, next) => {
  try {
    const updated = await ArchiveCandidate.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'dismissed' } },
      { new: true }
    ).lean()
    if (!updated) return res.status(404).json({ error: 'Candidate not found' })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.get('/content', async (req, res, next) => {
  try {
    const items = await Content.find({ isDeleted: { $ne: true } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .select('title type bunnyVideoId isPremium isFeatured isPublished releaseYear rating genre badge viewCount likeCount dislikeCount communityRating communityRatingCount posterUrl')
      .lean()
    res.json(items)
  } catch (err) {
    next(err)
  }
})

router.post('/content', async (req, res, next) => {
  try {
    const {
      title, subtitle = '', type = 'Film', genre = [], cast = [], director = '',
      releaseYear, rating = 0, desc = '', posterUrl = '', backdropUrl = '',
      contentLanguage = 'Bengali', certification = null,
      contentWarnings = '', moodTags = [], badge = null, subtitleUrl = '',
      isPremium = false, isFeatured = false, seasons = [],
    } = req.body

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
    if (!['Film', 'Series', 'Serial Drama', 'Documentary', 'Live'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' })
    }

    const content = await Content.create({
      title:           title.trim(),
      subtitle:        subtitle?.trim() || '',
      type,
      genre:           Array.isArray(genre) ? genre : [],
      cast:            Array.isArray(cast)  ? cast  : [],
      director:        director?.trim() || '',
      releaseYear:     releaseYear ? Number(releaseYear) : null,
      rating:          Number(rating) || 0,
      desc:            desc?.trim() || '',
      posterUrl:       posterUrl?.trim() || '',
      backdropUrl:     backdropUrl?.trim() || '',
      subtitleUrl:     subtitleUrl?.trim() || '',
      contentLanguage: contentLanguage || 'Bengali',
      certification:   certification || null,
      contentWarnings: contentWarnings?.trim() || '',
      moodTags:        Array.isArray(moodTags) ? moodTags : [],
      badge:           badge || null,
      isPremium:       Boolean(isPremium),
      isFeatured:      Boolean(isFeatured),
      isPublished:     false,
      submissionStatus: 'approved',
      seasons: (type === 'Series' || type === 'Serial Drama') && Array.isArray(seasons)
        ? seasons
            .filter((s) => s.number)
            .map((s) => ({
              number:   Number(s.number),
              title:    String(s.title || '').trim(),
              episodes: Array.isArray(s.episodes)
                ? s.episodes
                    .filter((ep) => ep.number && ep.title)
                    .map((ep) => ({
                      number:       Number(ep.number),
                      title:        String(ep.title).trim(),
                      desc:         String(ep.desc  || '').trim(),
                      duration:     String(ep.duration || '').trim(),
                      bunnyVideoId: '',
                      subtitleUrl:  String(ep.subtitleUrl || '').trim(),
                    }))
                : [],
            }))
        : [],
    })

    res.status(201).json(content)
  } catch (err) {
    next(err)
  }
})

router.get('/content/:id', async (req, res, next) => {
  try {
    const item = await Content.findById(req.params.id).lean()
    if (!item) return res.status(404).json({ error: 'Content not found' })
    res.json(item)
  } catch (err) {
    next(err)
  }
})

const ALLOWED_METADATA_FIELDS = [
  'title', 'subtitle', 'desc', 'type', 'duration', 'genre', 'cast', 'director',
  'releaseYear', 'rating', 'isPremium', 'isFeatured', 'badge',
  'posterUrl', 'backdropUrl', 'palette', 'subtitleUrl',
  'contentLanguage', 'certification', 'contentWarnings', 'moodTags', 'reviewCount',
  'seasons',
]

router.patch('/content/:id', async (req, res, next) => {
  try {
    const updates = {}
    for (const key of ALLOWED_METADATA_FIELDS) {
      if (key in req.body) updates[key] = req.body[key]
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const item = await Content.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean()

    if (!item) return res.status(404).json({ error: 'Content not found' })
    bustContentCache()
    res.json(item)
  } catch (err) {
    next(err)
  }
})

router.patch('/content/:id/publish', async (req, res, next) => {
  try {
    const { publish } = req.body
    if (typeof publish !== 'boolean') {
      return res.status(400).json({ error: '`publish` must be a boolean' })
    }

    const item = await Content.findById(req.params.id).select('bunnyVideoId type seasons isPublished').lean()
    if (!item) return res.status(404).json({ error: 'Content not found' })

    if (publish) {
      const hasVideo = (item.type === 'Series' || item.type === 'Serial Drama')
        ? item.seasons?.some((s) => s.episodes?.some((ep) => ep.bunnyVideoId))
        : Boolean(item.bunnyVideoId)
      if (!hasVideo) {
        return res.status(400).json({ error: 'Cannot publish: video is not ready yet. Wait for transcoding to complete.' })
      }
    }

    const updated = await Content.findByIdAndUpdate(
      req.params.id,
      { $set: { isPublished: publish } },
      { new: true }
    ).select('title isPublished').lean()

    bustContentCache()
    logAdminAction(req, publish ? 'publish_content' : 'unpublish_content', 'content', updated._id, updated.title)
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.post('/map-existing-video', async (req, res, next) => {
  try {
    const { contentId, bunnyVideoId, seasonNumber, episodeNumber } = req.body
    if (!contentId || !bunnyVideoId) {
      return res.status(400).json({ error: 'contentId and bunnyVideoId are required' })
    }

    const content = await Content.findById(contentId).select('title type').lean()
    if (!content) return res.status(404).json({ error: 'Content not found' })

    const vid = String(bunnyVideoId).trim()
    const isEpisodic = content.type === 'Series' || content.type === 'Serial Drama'

    if (isEpisodic && episodeNumber) {
      const sNum = Number(seasonNumber  || 1)
      const eNum = Number(episodeNumber)

      const linked = await Content.findOneAndUpdate(
        { _id: contentId, 'seasons.number': sNum, 'seasons.episodes.number': eNum },
        { $set: { 'seasons.$[s].episodes.$[e].bunnyVideoId': vid } },
        { arrayFilters: [{ 's.number': sNum }, { 'e.number': eNum }], new: true }
      ).lean()

      if (!linked) {
        const hasSeason = await Content.exists({ _id: contentId, 'seasons.number': sNum })
        if (hasSeason) {
          await Content.findOneAndUpdate(
            { _id: contentId, 'seasons.number': sNum },
            { $push: { 'seasons.$.episodes': { number: eNum, title: '', duration: '', bunnyVideoId: vid } } }
          )
        } else {
          await Content.findByIdAndUpdate(contentId, {
            $push: { seasons: { number: sNum, title: '', episodes: [{ number: eNum, title: '', duration: '', bunnyVideoId: vid }] } },
          })
        }
      }

      bustContentCache()
      return res.json({ success: true, message: `Mapped video to S${sNum}E${eNum} of "${content.title}".` })
    }

    // Film / Documentary — or series mapped to root (legacy / trailer use-case)
    const updated = await Content.findByIdAndUpdate(
      contentId,
      { $set: { bunnyVideoId: vid } },
      { new: true }
    ).select('title bunnyVideoId type').lean()

    bustContentCache()
    res.json({ success: true, content: updated, message: `Mapped Bunny video to "${updated.title}".` })
  } catch (err) {
    next(err)
  }
})

router.get('/upload-jobs', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)))
    const jobs = await UploadJob.find()
      .sort({ updatedAt: -1 })
      .limit(limit)
      .populate('collectionId', 'name bunnyCollectionId')
      .lean()

    const synced = await Promise.all(jobs.map((job) => syncProcessingJob(job)))
    res.json(synced)
  } catch (err) {
    next(err)
  }
})

router.post('/upload-jobs', async (req, res, next) => {
  try {
    const {
      title, collectionId,
      contentId       = null,
      reelId          = null,
      seasonNumber    = null,
      episodeNumber   = null,
      episodeTitle    = '',
      episodeDuration = '',
    } = req.body

    if (!title || !collectionId) {
      return res.status(400).json({ error: 'title and collectionId are required' })
    }
    if (contentId && reelId) {
      return res.status(400).json({ error: 'Provide contentId or reelId, not both' })
    }

    const collection = await StreamCollection.findById(collectionId).lean()
    if (!collection || !collection.isActive) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    const job = await UploadJob.create({
      createdByEmail:    req.user.email,
      title:             title.trim(),
      collectionId:      collection._id,
      collectionName:    collection.name,
      bunnyCollectionId: collection.bunnyCollectionId,
      contentId,
      reelId,
      seasonNumber:      seasonNumber    ? Number(seasonNumber)       : null,
      episodeNumber:     episodeNumber   ? Number(episodeNumber)      : null,
      episodeTitle:      episodeTitle    ? String(episodeTitle).trim() : '',
      episodeDuration:   episodeDuration ? String(episodeDuration).trim() : '',
      status:   'awaiting_file',
      progress: 0,
      note:     'Upload job created. Waiting for file bytes.',
    })

    res.status(201).json(job)
  } catch (err) {
    next(err)
  }
})

router.get('/upload-jobs/:id', async (req, res, next) => {
  try {
    const job = await UploadJob.findById(req.params.id)
      .populate('collectionId', 'name bunnyCollectionId')
      .lean()
    if (!job) return res.status(404).json({ error: 'Upload job not found' })
    res.json(job)
  } catch (err) {
    next(err)
  }
})

// Cancel an in-flight job (queued or transcoding). Deletes the Bunny video if
// one exists and marks the job cancelled. Driven by job status, so the Cancel
// button is derived from server state and survives a page refresh.
router.patch('/upload-jobs/:id/cancel', async (req, res, next) => {
  try {
    const job = await UploadJob.findById(req.params.id)
    if (!job) return res.status(404).json({ error: 'Upload job not found' })
    if (!['awaiting_file', 'queued', 'uploading', 'processing'].includes(job.status)) {
      return res.status(409).json({ error: `Cannot cancel a job that is "${job.status}"` })
    }

    if (job.bunnyVideoId) {
      await bunnyRequest(`/library/${libraryId}/videos/${job.bunnyVideoId}`, { method: 'DELETE' }).catch(() => {})
    }
    job.status = 'cancelled'
    job.progress = 0
    job.note = 'Cancelled by admin.'
    job.error = ''
    await job.save()
    res.json(job.toObject())
  } catch (err) {
    next(err)
  }
})

// Retry a failed or cancelled fetch-based (archive.org) job by re-fetching the
// source into a fresh Bunny video. The existing job-sync then links it when ready.
router.patch('/upload-jobs/:id/retry', async (req, res, next) => {
  try {
    const job = await UploadJob.findById(req.params.id)
    if (!job) return res.status(404).json({ error: 'Upload job not found' })
    if (!['failed', 'cancelled'].includes(job.status)) {
      return res.status(409).json({ error: `Can only retry a failed or cancelled job (is "${job.status}")` })
    }
    if (!job.sourceUrl) {
      return res.status(400).json({ error: 'This job has no source URL to retry from (re-upload manually).' })
    }

    const bunnyVideoId = await bunnyFetchFromUrl(job.sourceUrl, job.title, job.bunnyCollectionId)
    job.bunnyVideoId = bunnyVideoId
    job.status = 'processing'
    job.progress = 50
    job.note = 'Re-fetching from source…'
    job.error = ''
    await job.save()
    res.json(job.toObject())
  } catch (err) {
    next(err)
  }
})

router.put('/upload-jobs/:id/file', async (req, res, next) => {
  let tmpPath = null
  try {
    const job = await UploadJob.findById(req.params.id)
    if (!job) return res.status(404).json({ error: 'Upload job not found' })
    if (job.status !== 'awaiting_file') {
      return res.status(409).json({ error: `Job is already in "${job.status}" state` })
    }

    const contentLength = Number(req.headers['content-length'] || 0)
    const maxBytes = 2 * 1024 * 1024 * 1024
    if (!contentLength) {
      return res.status(411).json({ error: 'Content-Length is required for video uploads' })
    }
    if (contentLength > maxBytes) {
      return res.status(413).json({ error: 'Upload exceeds the 2 GB limit' })
    }

    const fileName = String(req.headers['x-file-name'] || '').slice(0, 240)
    const allowedExtensions = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.ts', '.mts']
    const fileExt = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : ''
    if (fileName && !allowedExtensions.includes(fileExt)) {
      return res.status(415).json({ error: `Unsupported file type "${fileExt}". Allowed: ${allowedExtensions.join(', ')}` })
    }

    // Buffer the entire request body to a temp file BEFORE making any Bunny API calls.
    // Streaming req directly to Bunny caused "TypeError: fetch failed" because the
    // browser's TCP connection was held open while we made Bunny API calls (500ms–2s),
    // and any proxy/connection timeout would destroy req mid-transfer, breaking the
    // downstream fetch. Decoupling browser→server from server→Bunny fixes this.
    tmpPath = join(tmpdir(), `dhara-upload-${randomUUID()}.tmp`)
    await pipeline(req, createWriteStream(tmpPath))

    // Verify the target Bunny collection still exists; auto-create it if it was deleted.
    let bunnyCollectionId = job.bunnyCollectionId
    if (bunnyCollectionId) {
      try {
        await bunnyRequest(`/library/${libraryId}/collections/${bunnyCollectionId}`)
      } catch {
        try {
          const newCol = await bunnyRequest(`/library/${libraryId}/collections`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: job.collectionName }),
          })
          const newGuid = String(newCol?.guid || '').trim()
          if (newGuid) {
            await StreamCollection.findOneAndUpdate(
              { bunnyCollectionId },
              { $set: { bunnyCollectionId: newGuid, isActive: true } }
            )
            bunnyCollectionId = newGuid
          }
        } catch (colErr) {
          console.warn('[upload] Could not auto-create Bunny collection:', colErr.message)
        }
      }
    }

    await UploadJob.findByIdAndUpdate(job._id, {
      $set: {
        status: 'queued',
        progress: 10,
        note: 'File received. Uploading to Bunny CDN…',
        fileName,
        bunnyCollectionId,
      },
    })

    // Upload from the temp file — a reliable disk read that can't be interrupted
    // by browser disconnect or proxy timeouts. processUploadJob throws on failure
    // after updating the job status to 'failed'.
    await processUploadJob(job._id, createReadStream(tmpPath), contentLength)

    res.status(202).json({ success: true, jobId: job._id, message: 'File received. Bunny is transcoding.' })
  } catch (err) {
    // Job is already marked 'failed' by processUploadJob (if it got that far);
    // surface the raw error to the client XHR.
    next(err)
  } finally {
    // Always clean up the temp file, whether upload succeeded or failed
    if (tmpPath) unlink(tmpPath, () => {})
  }
})

/**
 * GET /api/admin/transactions
 * Full transaction log with optional filters: status, plan, page.
 */
router.get('/transactions', async (req, res, next) => {
  try {
    const { status, plan, page = 1 } = req.query
    const limit = 50
    const filter = {}
    if (status) filter.status = status
    if (plan)   filter.plan   = plan

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * limit)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
    ])

    res.json({
      transactions: transactions.map((t) => ({
        id:         t._id,
        userId:     t.userId,
        userEmail:  t.userEmail,
        plan:       t.plan,
        planLabel:  t.planSnapshot?.label || t.plan,
        amount:     t.amount,
        currency:   t.currency,
        status:     t.status,
        gateway:    t.gateway,
        orderId:    t.orderId,
        paymentId:  t.paymentId,
        failureReason: t.failureReason || null,
        date:       t.createdAt,
      })),
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/revenue
 * Aggregated revenue stats: total, monthly breakdown, plan breakdown,
 * subscriber counts by status.
 */
router.get('/revenue', async (req, res, next) => {
  try {
    const twelveMonthsAgo = new Date(Date.now() - 365 * 86_400_000)

    const [
      planBreakdown, monthlyRevenue, subscriberCounts, totalPaid,
      creatorSummaryAgg, monthlyCreatorPayoutsAgg,
    ] = await Promise.all([
      Transaction.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: '$plan', revenue: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { revenue: -1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'paid', createdAt: { $gte: twelveMonthsAgo } } },
        {
          $group: {
            _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            revenue: { $sum: '$amount' },
            count:   { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      User.aggregate([
        { $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Aggregate creator earnings totals from DB
      CreatorEarning.aggregate([
        { $group: {
          _id:          null,
          pendingPaise: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$netAmountPaise', 0] } },
          paidPaise:    { $sum: { $cond: [{ $eq: ['$status', 'paid']    }, '$netAmountPaise', 0] } },
          creatorIds:   { $addToSet: '$creatorId' },
        }},
      ]),
      // Monthly creator payout trend (last 12 months) from DB
      CreatorPayout.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: twelveMonthsAgo } } },
        { $group: {
          _id:         { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } },
          amountPaise: { $sum: '$amountPaise' },
          count:       { $sum: 1 },
        }},
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ])

    const cs = creatorSummaryAgg[0] ?? {}

    res.json({
      totalRevenuePaise: totalPaid[0]?.total || 0,
      totalTransactions: totalPaid[0]?.count || 0,
      planBreakdown: planBreakdown.map((p) => ({
        plan:             p._id,
        revenuePaise:     p.revenue,
        transactionCount: p.count,
      })),
      monthlyRevenue: monthlyRevenue.map((m) => ({
        year:         m._id.year,
        month:        m._id.month,
        revenuePaise: m.revenue,
        count:        m.count,
      })),
      subscribersByStatus: Object.fromEntries(
        subscriberCounts.map((s) => [s._id, s.count])
      ),
      creatorSummary: {
        totalPendingPaise: cs.pendingPaise      || 0,
        totalPaidPaise:    cs.paidPaise         || 0,
        earningCreators:   cs.creatorIds?.length || 0,
      },
      monthlyCreatorPayouts: monthlyCreatorPayoutsAgg.map((m) => ({
        year:        m._id.year,
        month:       m._id.month,
        amountPaise: m.amountPaise,
        count:       m.count,
      })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/creator-applications
 * List all creator applications, filterable by status.
 */
router.get('/creator-applications', async (req, res, next) => {
  try {
    const { status = 'applied' } = req.query

    // Always restrict to users who have actually interacted with the creator flow.
    // 'none' is the default — those users have never applied and should never appear here.
    const creatorStatuses = ['applied', 'approved', 'rejected']
    const filter = status === 'all'
      ? { creatorStatus: { $in: creatorStatuses } }
      : { creatorStatus: status }

    const users = await User.find(filter)
      .sort({ 'creatorProfile.appliedAt': -1, createdAt: -1 })
      .select('email displayName creatorStatus isCreator creatorProfile creatorRejectionReason creatorRejectedAt createdAt')
      .limit(ADMIN_LIST_CAP)
      .lean()

    res.json(users)
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/creator-applications/:userId/approve
 */
router.patch('/creator-applications/:userId/approve', async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: { creatorStatus: 'approved', isCreator: true, creatorRejectionReason: '', creatorRejectedAt: null } },
      { new: true }
    ).select('email displayName creatorStatus isCreator creatorProfile')

    if (!user) return res.status(404).json({ error: 'User not found' })

    emailCreatorApproved(user.creatorProfile?.studioName || user.displayName, user.email)
      .catch((err) => console.error('[email] creator-approved failed:', err.message))

    logAdminAction(req, 'approve_creator', 'user', user._id, user.email)
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/creator-applications/:userId/reject
 */
router.patch('/creator-applications/:userId/reject', async (req, res, next) => {
  try {
    const { reason = '' } = req.body
    const safeReason = escapeHtml(reason.trim())

    // Fetch current rejection count to enforce three-strikes cooldown
    const existing = await User.findById(req.params.userId).select('creatorRejectionCount').lean()
    if (!existing) return res.status(404).json({ error: 'User not found' })

    const newCount = (existing.creatorRejectionCount || 0) + 1
    // After 3 rejections, enforce a 30-day cooldown before the creator can reapply
    const reapplyAfter = newCount >= 3 ? new Date(Date.now() + 30 * 86_400_000) : null

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      {
        $set: {
          creatorStatus:          'rejected',
          isCreator:              false,
          creatorRejectionReason: safeReason,
          creatorRejectedAt:      new Date(),
          creatorRejectionCount:  newCount,
          ...(reapplyAfter ? { creatorReapplyAfter: reapplyAfter } : {}),
        },
      },
      { new: true }
    ).select('email displayName creatorStatus isCreator creatorProfile creatorRejectionCount creatorReapplyAfter')

    emailCreatorRejected(user.creatorProfile?.studioName || user.displayName, user.email, safeReason)
      .catch((err) => console.error('[email] creator-rejected failed:', err.message))

    logAdminAction(req, 'reject_creator', 'user', user._id, user.email, { reason: safeReason, rejectionCount: newCount })
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/submissions
 * List creator content submissions, filterable by submissionStatus.
 */
router.get('/submissions', async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query
    const filter = { creatorId: { $ne: null } }
    if (status !== 'all') filter.submissionStatus = status

    const items = await Content.find(filter)
      .sort({ updatedAt: -1 })
      .populate('creatorId', 'email displayName creatorProfile')
      .select('title type genre submissionStatus rejectionReason revisionCount posterUrl bunnyVideoId creatorId createdAt updatedAt isPremium')
      .limit(ADMIN_LIST_CAP)
      .lean()

    res.json(items)
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/submissions/:id/approve
 */
router.patch('/submissions/:id/approve', async (req, res, next) => {
  try {
    const content = await Content.findOneAndUpdate(
      { _id: req.params.id, creatorId: { $ne: null } },
      { $set: { submissionStatus: 'approved', rejectionReason: '' } },
      { new: true }
    ).populate('creatorId', 'email displayName creatorProfile').lean()

    if (!content) return res.status(404).json({ error: 'Submission not found' })
    bustContentCache()

    if (content.creatorId) {
      const creator = content.creatorId
      emailSubmissionApproved(
        creator.creatorProfile?.studioName || creator.displayName,
        creator.email,
        content.title
      ).catch((err) => console.error('[email] submission-approved failed:', err.message))
    }

    logAdminAction(req, 'approve_submission', 'content', content._id, content.title)
    res.json({ success: true, content })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/submissions/:id/reject
 */
router.patch('/submissions/:id/reject', async (req, res, next) => {
  try {
    const { reason = '' } = req.body
    if (!reason.trim()) return res.status(400).json({ error: 'Rejection reason is required' })

    const safeReason = escapeHtml(reason.trim())

    const content = await Content.findOneAndUpdate(
      { _id: req.params.id, creatorId: { $ne: null } },
      { $set: { submissionStatus: 'rejected', rejectionReason: safeReason } },
      { new: true }
    ).populate('creatorId', 'email displayName creatorProfile').lean()

    if (!content) return res.status(404).json({ error: 'Submission not found' })

    if (content.creatorId) {
      const creator = content.creatorId
      emailSubmissionRejected(
        creator.creatorProfile?.studioName || creator.displayName,
        creator.email,
        content.title,
        safeReason
      ).catch((err) => console.error('[email] submission-rejected failed:', err.message))
    }

    logAdminAction(req, 'reject_submission', 'content', content._id, content.title, { reason: safeReason })
    res.json({ success: true, content })
  } catch (err) {
    next(err)
  }
})

// ── Curated Shelves ───────────────────────────────────────────────────────────

router.get('/shelves', async (req, res, next) => {
  try {
    const shelves = await CuratedShelf.find().sort({ displayOrder: 1 }).lean()
    res.json(shelves)
  } catch (err) { next(err) }
})

router.post('/shelves', async (req, res, next) => {
  try {
    const { name, tagline = '', backdropUrl = '', accentColor = '#f59e0b', contentIds = [] } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
    const count = await CuratedShelf.countDocuments()
    const shelf = await CuratedShelf.create({
      name: name.trim(), tagline: tagline.trim(), backdropUrl: backdropUrl.trim(),
      accentColor, contentIds, displayOrder: count,
    })
    res.status(201).json(shelf)
  } catch (err) { next(err) }
})

// Must precede /:id to avoid route collision
router.patch('/shelves/reorder', async (req, res, next) => {
  try {
    const { order } = req.body
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' })
    await Promise.all(order.map(({ id, displayOrder }) =>
      CuratedShelf.findByIdAndUpdate(id, { $set: { displayOrder } })
    ))
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.patch('/shelves/:id', async (req, res, next) => {
  try {
    const ALLOWED = ['name', 'tagline', 'backdropUrl', 'accentColor', 'contentIds', 'isActive', 'displayOrder']
    const updates = {}
    for (const key of ALLOWED) {
      if (key in req.body) updates[key] = req.body[key]
    }
    const shelf = await CuratedShelf.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' })
    res.json(shelf)
  } catch (err) { next(err) }
})

router.delete('/shelves/:id', async (req, res, next) => {
  try {
    await CuratedShelf.findByIdAndDelete(req.params.id)
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ── Creator Revenue — admin endpoints ─────────────────────────────────────────

const TIERS = [
  { name: 'Newcomer',    level: 1, minViews: 0,       maxViews: 999,      share: 60, nextTier: 'Rising Star', nextMin: 1_000    },
  { name: 'Rising Star', level: 2, minViews: 1_000,   maxViews: 9_999,    share: 65, nextTier: 'Established', nextMin: 10_000   },
  { name: 'Established', level: 3, minViews: 10_000,  maxViews: 99_999,   share: 70, nextTier: 'Featured',    nextMin: 100_000  },
  { name: 'Featured',    level: 4, minViews: 100_000, maxViews: Infinity,  share: 75, nextTier: null,          nextMin: null     },
]

function tierFor(totalViews) {
  return TIERS.find((t) => totalViews <= t.maxViews) ?? TIERS[TIERS.length - 1]
}

/**
 * POST /api/admin/revenue/calculate
 * Calculates creator earnings for a given month/year.
 * Body: { month, year, ratePerViewPaise? }
 * ratePerViewPaise defaults to 50 (₹0.50 per view).
 *
 * For each approved creator content piece:
 *   monthlyViews = viewCount - viewCountSnapshot
 *   grossPaise   = monthlyViews × ratePerViewPaise
 *   netPaise     = grossPaise × (creatorShare / 100)
 * Creates a CreatorEarning record and advances the snapshot.
 * Skips content with no new views or already calculated for that period.
 */
router.post('/revenue/calculate', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const now   = new Date()
    const month = Number(req.body.month ?? now.getMonth() + 1)
    const year  = Number(req.body.year  ?? now.getFullYear())
    const rate  = Number(req.body.ratePerViewPaise ?? 50)

    if (month < 1 || month > 12) return res.status(400).json({ error: 'month must be 1–12' })
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ error: 'ratePerViewPaise must be a positive number' })
    }

    // Shared with the scheduled job (earningsJob.js) — batches the idempotency
    // check into one query and safely ignores concurrent-run duplicate-key errors.
    const { created, skipped } = await calculateMonthlyEarnings(month, year, rate)

    res.json({
      month, year,
      ratePerViewPaise: rate,
      earningsCreated: created,
      skipped,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/creator-earnings
 * Lists all creators with their pending balance, total earned, and payout history summary.
 * Optional query: ?status=pending|paid|all (default: all)
 */
router.get('/creator-earnings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const statusFilter = req.query.status
    const match = statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}

    const rows = await CreatorEarning.aggregate([
      { $match: match },
      { $group: {
        _id:            '$creatorId',
        totalNetPaise:  { $sum: '$netAmountPaise' },
        pendingPaise:   { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$netAmountPaise', 0] } },
        paidPaise:      { $sum: { $cond: [{ $eq: ['$status', 'paid']    }, '$netAmountPaise', 0] } },
        totalViews:     { $sum: '$viewCount' },
        recordCount:    { $sum: 1 },
        latestMonth:    { $max: { $add: [{ $multiply: ['$year', 100] }, '$month'] } },
      }},
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'creator' } },
      { $unwind: '$creator' },
      { $project: {
        _id: 1,
        studioName:    '$creator.creatorProfile.studioName',
        email:         '$creator.email',
        totalNetPaise: 1,
        pendingPaise:  1,
        paidPaise:     1,
        totalViews:    1,
        recordCount:   1,
        latestMonth:   1,
      }},
      { $sort: { pendingPaise: -1 } },
    ])

    res.json(rows.map((r) => ({
      creatorId:   r._id,
      studioName:  r.studioName || '—',
      email:       r.email,
      totalEarned: Math.round(r.totalNetPaise / 100),
      pending:     Math.round(r.pendingPaise  / 100),
      paidOut:     Math.round(r.paidPaise     / 100),
      totalViews:  r.totalViews,
      recordCount: r.recordCount,
      tier:        tierFor(r.totalViews).name,
    })))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/admin/creator-payouts
 * Initiates a payout to a creator — marks all their pending earnings as paid.
 * Body: { creatorId, method?, referenceId?, notes? }
 */
router.post('/creator-payouts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { creatorId, method = 'Bank Transfer', referenceId = '', notes = '' } = req.body
    if (!creatorId) return res.status(400).json({ error: 'creatorId is required' })

    const pendingEarnings = await CreatorEarning.find({ creatorId, status: 'pending' }).lean()
    if (!pendingEarnings.length) {
      return res.status(400).json({ error: 'No pending earnings for this creator' })
    }

    const totalPaise = pendingEarnings.reduce((s, e) => s + e.netAmountPaise, 0)

    const payout = await CreatorPayout.create({
      creatorId,
      amountPaise:  totalPaise,
      earningIds:   pendingEarnings.map((e) => e._id),
      method,
      referenceId,
      notes,
      status:       'paid',
      paidAt:       new Date(),
      initiatedBy:  req.user._id,
    })

    // Mark all earnings as paid
    await CreatorEarning.updateMany(
      { _id: { $in: pendingEarnings.map((e) => e._id) } },
      { $set: { status: 'paid', payoutId: payout._id } }
    )

    logAdminAction(req, 'initiate_payout', 'user', creatorId, '', {
      amountRupees: Math.round(totalPaise / 100),
      earningsCount: pendingEarnings.length,
      method,
    })

    res.json({
      payoutId:    payout._id,
      creatorId,
      amountRupees: Math.round(totalPaise / 100),
      earningsSettled: pendingEarnings.length,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/creator-payouts
 * Lists all payouts across all creators.
 */
router.get('/creator-payouts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const payouts = await CreatorPayout.find()
      .sort({ createdAt: -1 })
      .populate('creatorId', 'email creatorProfile')
      .limit(ADMIN_LIST_CAP)
      .lean()

    res.json(payouts.map((p) => ({
      _id:          p._id,
      studioName:   p.creatorId?.creatorProfile?.studioName || '—',
      email:        p.creatorId?.email || '—',
      amountRupees: Math.round(p.amountPaise / 100),
      method:       p.method,
      status:       p.status,
      paidAt:       p.paidAt,
      referenceId:  p.referenceId,
      notes:        p.notes,
      earningsCount: p.earningIds?.length ?? 0,
      createdAt:    p.createdAt,
    })))
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/monitor
 * Platform health dashboard — upload job health, DAU, subscription trend,
 * content stats. All figures are aggregated live from MongoDB.
 */
router.get('/monitor', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const now            = new Date()
    // Use IST (UTC+5:30) for all "today" / "this month" boundaries so the dashboard
    // matches what Indian admins expect regardless of server timezone.
    const IST_OFFSET_MS  = 5.5 * 60 * 60 * 1000
    const nowIST         = new Date(now.getTime() + IST_OFFSET_MS)
    const todayStart     = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate()) - IST_OFFSET_MS)
    const monthStart     = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), 1) - IST_OFFSET_MS)
    const sevenDaysAgo   = new Date(Date.now() - 8   * 86_400_000)  // 8 days window ensures IST day boundaries never cut off the oldest bar
    const thirtyDaysAgo  = new Date(Date.now() - 30  * 86_400_000)
    const sixMonthsAgo   = new Date(Date.now() - 180 * 86_400_000)
    const twentyFourHAgo = new Date(Date.now() - 86_400_000)

    const [
      jobStatusAgg,
      recentFailedJobs,
      processingJobs,
      dauAgg,
      dauToday,
      totalUsers,
      newUsersThisMonth,
      subStatusAgg,
      newSubsAgg,
      lapsedAgg,
      contentAgg,
      pendingApplications,
      pendingSubmissions,
      pendingReels,
      paymentTodayAgg,
      lastSuccessfulPayment,
      topContentAgg,
      deviceAgg,
      geoAgg,
    ] = await Promise.all([

      UploadJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

      UploadJob.find({ status: 'failed' })
        .sort({ updatedAt: -1 }).limit(5)
        .select('title seasonNumber episodeNumber error updatedAt').lean(),

      UploadJob.find({ status: { $in: ['uploading', 'processing'] } })
        .sort({ updatedAt: -1 }).limit(10)
        .select('title seasonNumber episodeNumber status progress updatedAt').lean(),

      User.aggregate([
        { $match: { lastLoginAt: { $gte: sevenDaysAgo } } },
        { $group: {
          _id:   { $dateToString: { format: '%Y-%m-%d', date: '$lastLoginAt', timezone: 'Asia/Kolkata' } },
          users: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),

      User.countDocuments({ lastLoginAt: { $gte: todayStart } }),
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: monthStart } }),

      User.aggregate([{ $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } }]),

      Transaction.aggregate([
        { $match: { status: 'paid', createdAt: { $gte: sixMonthsAgo } } },
        { $group: {
          _id:   { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),

      User.aggregate([
        { $match: { subscriptionStatus: 'lapsed', subscriptionExpiresAt: { $gte: sixMonthsAgo } } },
        { $group: {
          _id:   { $dateToString: { format: '%Y-%m', date: '$subscriptionExpiresAt' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),

      Content.aggregate([
        { $match: { isPublished: true, isDeleted: { $ne: true } } },
        { $group: {
          _id:            null,
          total:          { $sum: 1 },
          totalViews:     { $sum: '$viewCount' },
          addedThisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, 1, 0] } },
        }},
      ]),

      // ── Creator action queue ─────────────────────────────────────────────────
      User.countDocuments({ creatorStatus: 'applied' }),
      Content.countDocuments({ submissionStatus: 'pending', isPublished: false }),
      Reel.countDocuments({ submissionStatus: 'pending', isDeleted: { $ne: true } }),

      // ── Payment health today — from Transaction ───────────────────────────
      Transaction.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: {
          _id:        '$status',
          count:      { $sum: 1 },
          totalPaise: { $sum: '$amount' },
        }},
      ]),

      // ── NEW: Last successful payment timestamp ────────────────────────────
      Transaction.findOne({ status: 'paid' }).sort({ createdAt: -1 }).select('createdAt').lean(),

      // ── NEW: Top 5 content by views in last 24h — from ViewEvent + Content ─
      ViewEvent.aggregate([
        { $match: { viewedAt: { $gte: twentyFourHAgo } } },
        { $group: { _id: '$contentId', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'contents', localField: '_id', foreignField: '_id', as: 'c' } },
        { $unwind: { path: '$c', preserveNullAndEmptyArrays: false } },
        { $project: { title: '$c.title', type: '$c.type', views: 1 } },
      ]),

      // ── NEW: Device breakdown last 7 days — from ViewEvent ────────────────
      ViewEvent.aggregate([
        { $match: { viewedAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // ── Top 5 states/countries last 7 days — from ViewEvent ─────────────────
      // No country filter: loopback IPs (localhost) resolve to 'Unknown' not 'IN',
      // and pre-launch traffic may come from any IP. Show all locations.
      ViewEvent.aggregate([
        { $match: { viewedAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: '$state', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ])

    // ── Derived values ────────────────────────────────────────────────────────

    const dauByDay = Array.from({ length: 7 }, (_, i) => {
      const d       = new Date(Date.now() - (6 - i) * 86_400_000)
      const dateStr = new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)
      return { date: dateStr, users: dauAgg.find(a => a._id === dateStr)?.users || 0 }
    })

    const subTrend = Array.from({ length: 6 }, (_, i) => {
      const d   = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return {
        month:   key,
        newSubs: newSubsAgg.find(a => a._id === key)?.count || 0,
        churned: lapsedAgg.find(a  => a._id === key)?.count || 0,
      }
    })

    const jobHealth  = Object.fromEntries(jobStatusAgg.map(j => [j._id, j.count]))
    const activeJobs = (jobHealth.uploading || 0) + (jobHealth.processing || 0)

    const subCounts = Object.fromEntries(subStatusAgg.map(s => [s._id, s.count]))
    const paying    = (subCounts.active || 0) + (subCounts.trial || 0) + (subCounts.grace || 0)
    const lapsed30  = await User.countDocuments({ subscriptionStatus: 'lapsed', subscriptionExpiresAt: { $gte: thirtyDaysAgo } })
    const churnRate = paying + lapsed30 > 0 ? Number(((lapsed30 / (paying + lapsed30)) * 100).toFixed(1)) : 0

    const payToday   = Object.fromEntries(paymentTodayAgg.map(p => [p._id, { count: p.count, paise: p.totalPaise }]))
    const paidToday  = payToday.paid  || { count: 0, paise: 0 }
    const failedToday = payToday.failed?.count || 0
    const totalAttempts = Object.values(payToday).reduce((s, v) => s + v.count, 0)
    const paySuccessRate = totalAttempts > 0 ? Math.round((paidToday.count / totalAttempts) * 100) : null

    const content = contentAgg[0] ?? { total: 0, totalViews: 0, addedThisMonth: 0 }

    res.json({
      uploadHealth: {
        byStatus: jobHealth,
        activeJobs,
        recentFailed: recentFailedJobs.map(j => ({
          title: j.episodeNumber ? `S${j.seasonNumber ?? 1}E${j.episodeNumber} — ${j.title}` : j.title,
          error: j.error || 'Unknown error',
          ago:   j.updatedAt,
        })),
        processing: processingJobs.map(j => ({
          title:    j.episodeNumber ? `S${j.seasonNumber ?? 1}E${j.episodeNumber} — ${j.title}` : j.title,
          status:   j.status,
          progress: j.progress,
        })),
      },
      dau: {
        today:     dauToday,
        last7Days: dauByDay,
        weeklyAvg: dauByDay.length
          ? Math.round(dauByDay.reduce((s, d) => s + d.users, 0) / dauByDay.length)
          : 0,
      },
      users: {
        total:        totalUsers,
        newThisMonth: newUsersThisMonth,
      },
      subscriptions: {
        byStatus: subCounts,
        paying,
        churnRate,
        trend:    subTrend,
      },
      content: {
        total:          content.total,
        totalViews:     content.totalViews,
        addedThisMonth: content.addedThisMonth,
      },
      // ── NEW ────────────────────────────────────────────────────────────────
      creatorActions: {
        pendingApplications,
        pendingSubmissions,
        pendingReels,
      },
      paymentHealth: {
        revenueToday:   Math.round(paidToday.paise / 100),
        paidToday:      paidToday.count,
        failedToday,
        successRate:    paySuccessRate,
        lastPaymentAt:  lastSuccessfulPayment?.createdAt || null,
      },
      topContent: topContentAgg.map((c, i) => ({
        rank:  i + 1,
        title: c.title,
        type:  c.type,
        views: c.views,
      })),
      audience: {
        devices: deviceAgg.map(d => ({ device: d._id || 'unknown', count: d.count })),
        states:  geoAgg.map(g => ({ state: g._id || 'Unknown', count: g.count })),
      },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/admin/content/:id
 * Soft-deletes content — sets isDeleted=true, unpublishes, and purges every
 * Bunny video attached to it (top-level + each episode). Clearing bunnyVideoId
 * matters for archive.org imports: re-importing the same archiveId is blocked
 * while a non-deleted Content doc holds it, so once it's actually gone from the
 * CDN (not just hidden) the same title is importable again from search results.
 */
router.delete('/content/:id', async (req, res, next) => {
  try {
    const existing = await Content.findById(req.params.id).select('title bunnyVideoId seasons').lean()
    if (!existing) return res.status(404).json({ error: 'Content not found' })

    const videoIds = [
      existing.bunnyVideoId,
      ...(existing.seasons || []).flatMap((s) => (s.episodes || []).map((e) => e.bunnyVideoId)),
    ].filter(Boolean)
    for (const guid of videoIds) {
      bunnyRequest(`/library/${libraryId}/videos/${guid}`, { method: 'DELETE' })
        .catch((err) => console.warn('[content-delete] Bunny delete failed (non-fatal):', err.message))
    }

    const clearedSeasons = (existing.seasons || []).map((s) => ({
      ...s,
      episodes: (s.episodes || []).map((e) => ({ ...e, bunnyVideoId: '' })),
    }))

    const item = await Content.findByIdAndUpdate(
      req.params.id,
      { $set: { isDeleted: true, isPublished: false, bunnyVideoId: '', seasons: clearedSeasons } },
      { new: true }
    ).select('title isDeleted isPublished').lean()

    bustContentCache()
    logAdminAction(req, 'delete_content', 'content', item._id, item.title)
    res.json({ success: true, item })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/admin/content/:id/restore
 * Restores a soft-deleted content item (does not auto-publish).
 */
router.post('/content/:id/restore', async (req, res, next) => {
  try {
    const item = await Content.findByIdAndUpdate(
      req.params.id,
      { $set: { isDeleted: false } },
      { new: true }
    ).select('title isDeleted isPublished').lean()

    if (!item) return res.status(404).json({ error: 'Content not found' })
    bustContentCache()
    logAdminAction(req, 'restore_content', 'content', item._id, item.title)
    res.json({ success: true, item })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/content/:id/featured-order
 * Sets the admin-defined sort position for featured content.
 * Body: { featuredOrder: number }
 */
router.patch('/content/:id/featured-order', async (req, res, next) => {
  try {
    const order = Number(req.body.featuredOrder)
    if (!Number.isFinite(order)) return res.status(400).json({ error: 'featuredOrder must be a number' })

    const item = await Content.findByIdAndUpdate(
      req.params.id,
      { $set: { featuredOrder: order } },
      { new: true }
    ).select('title featuredOrder').lean()

    if (!item) return res.status(404).json({ error: 'Content not found' })
    bustContentCache()
    res.json(item)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/admin/bunny/sync-deletions
 * Detects videos deleted from Bunny CDN and fully removes the matching content from the site.
 * For Film/Documentary/Live: soft-deletes the Content document (isDeleted=true, isPublished=false).
 * For Series/Serial Drama: clears stale episode bunnyVideoIds; if ALL episodes across the show
 *   are now without a video, soft-deletes the parent document too.
 * Safe to run anytime — uses soft-delete so content is recoverable by admin if needed.
 */
router.post('/bunny/sync-deletions', async (req, res, next) => {
  try {
    // Fetch every video GUID in this library by paginating the full list
    const activeGuids = new Set()
    let page = 1
    while (true) {
      const result = await bunnyRequest(
        `/library/${libraryId}/videos?page=${page}&itemsPerPage=100&orderBy=date`
      )
      const items = result?.items || []
      items.forEach((v) => { if (v.guid) activeGuids.add(v.guid) })
      const total = result?.totalItems ?? items.length
      if (items.length === 0 || page * 100 >= total) break
      page++
    }

    // Root-level content (Film / Documentary / Live) with a stale bunnyVideoId
    const rootContent = await Content.find({
      bunnyVideoId: { $exists: true, $ne: '' },
      isDeleted:    { $ne: true },
    }).select('_id title bunnyVideoId').lean()

    const rootStale = rootContent.filter((c) => !activeGuids.has(c.bunnyVideoId))

    if (rootStale.length > 0) {
      await Content.updateMany(
        { _id: { $in: rootStale.map((c) => c._id) } },
        { $set: { bunnyVideoId: '', isPublished: false, isDeleted: true } }
      )
    }

    // Episode-level stale bunnyVideoIds (Series / Serial Drama)
    const episodic = await Content.find({
      type:      { $in: ['Series', 'Serial Drama'] },
      isDeleted: { $ne: true },
      'seasons.episodes.bunnyVideoId': { $exists: true, $ne: '' },
    }).select('_id seasons').lean()

    let episodesCleared = 0
    const episodicDeleted = []

    for (const doc of episodic) {
      // Clear each stale episode video link
      for (const season of doc.seasons || []) {
        for (const ep of season.episodes || []) {
          if (ep.bunnyVideoId && !activeGuids.has(ep.bunnyVideoId)) {
            await Content.updateOne(
              { _id: doc._id, 'seasons.number': season.number, 'seasons.episodes.number': ep.number },
              { $set: { 'seasons.$[s].episodes.$[e].bunnyVideoId': '' } },
              { arrayFilters: [{ 's.number': season.number }, { 'e.number': ep.number }] }
            )
            episodesCleared++
            // Mutate local copy so the "all gone?" check below sees the cleared state
            ep.bunnyVideoId = ''
          }
        }
      }

      // If no episode in the entire show has a video anymore, soft-delete the show
      const hasAnyVideo = (doc.seasons || []).some((s) =>
        (s.episodes || []).some((ep) => ep.bunnyVideoId)
      )
      if (!hasAnyVideo) {
        await Content.findByIdAndUpdate(doc._id, { $set: { isPublished: false, isDeleted: true } })
        episodicDeleted.push(doc._id)
      }
    }

    bustContentCache()
    logAdminAction(req, 'sync_cdn_deletions', 'config', null, '', {
      activeBunnyVideos: activeGuids.size,
      rootDeleted: rootStale.length,
      episodesCleared,
      showsDeleted: episodicDeleted.length,
    })

    res.json({
      success: true,
      activeBunnyVideos: activeGuids.size,
      rootDeleted: rootStale.length,
      episodesCleared,
      showsDeleted: episodicDeleted.length,
      removed: rootStale.map((c) => ({ id: c._id, title: c.title })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/admin/bunny/prune-collections
 * Deactivates StreamCollection records whose bunnyCollectionId no longer exists in Bunny.
 * Safe to run anytime — only marks records inactive, does not delete them.
 */
router.post('/bunny/prune-collections', async (req, res, next) => {
  try {
    const liveCollections = await listAllBunnyCollections()
    const liveIds = new Set(liveCollections.map((c) => String(c.guid || '')).filter(Boolean))

    const all = await StreamCollection.find({ isActive: true }).select('_id bunnyCollectionId name').lean()
    const stale = all.filter((c) => c.bunnyCollectionId && !liveIds.has(c.bunnyCollectionId))

    if (stale.length > 0) {
      await StreamCollection.updateMany(
        { _id: { $in: stale.map((c) => c._id) } },
        { $set: { isActive: false } }
      )
    }

    logAdminAction(req, 'prune_collections', 'config', null, '', { pruned: stale.length })
    res.json({ pruned: stale.length, stale: stale.map((c) => ({ id: c._id, name: c.name })) })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/search-analytics
 * Top zero-result queries — reveals catalog gaps.
 * Query: ?days=30&limit=20
 */
router.get('/search-analytics', async (req, res, next) => {
  try {
    const days  = Math.min(365, Math.max(1, Number(req.query.days  || 30)))
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)))
    const since = new Date(Date.now() - days * 86_400_000)

    const topMissed = await SearchLog.aggregate([
      { $match: { resultCount: 0, createdAt: { $gte: since } } },
      { $group: { _id: '$query', count: { $sum: 1 }, lang: { $first: '$lang' } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])

    res.json({ days, topMissedQueries: topMissed.map((r) => ({ query: r._id, count: r.count, lang: r.lang })) })
  } catch (err) {
    next(err)
  }
})

// ── Admin Reels ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/reels
 * Lists all reels. Query: ?status=pending|approved|rejected|all
 */
router.get('/reels', async (req, res, next) => {
  try {
    const { status = 'pending', page = 1 } = req.query
    const limit  = 50
    const filter = { isDeleted: { $ne: true } }
    if (status !== 'all') filter.submissionStatus = status

    const [items, total] = await Promise.all([
      Reel.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * limit)
        .limit(limit)
        .populate('creatorId', 'email displayName creatorProfile')
        .lean(),
      Reel.countDocuments(filter),
    ])

    res.json({ items, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/reels/:id/approve
 */
router.patch('/reels/:id/approve', async (req, res, next) => {
  try {
    const reel = await Reel.findByIdAndUpdate(
      req.params.id,
      { $set: { submissionStatus: 'approved', isPublished: true, rejectionReason: '' } },
      { new: true }
    ).lean()

    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    logAdminAction(req, 'approve_reel', 'reel', reel._id, reel.title || reel._id.toString())
    res.json({ success: true, reel })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/admin/reels/:id/reject
 * Rejects the reel and deletes the uploaded video from Bunny Stream.
 * Clearing bunnyVideoId forces the creator to upload a new video on resubmission —
 * otherwise they could resubmit the exact same rejected content indefinitely.
 */
router.patch('/reels/:id/reject', async (req, res, next) => {
  try {
    const { reason = '' } = req.body
    if (!reason.trim()) return res.status(400).json({ error: 'Rejection reason is required' })

    const safeReason = escapeHtml(reason.trim())

    // Fetch first so we have bunnyVideoId before clearing it
    const existing = await Reel.findById(req.params.id).select('bunnyVideoId title').lean()
    if (!existing) return res.status(404).json({ error: 'Reel not found' })

    // Delete the video from Bunny to reclaim storage immediately
    if (existing.bunnyVideoId) {
      bunnyRequest(`/library/${libraryId}/videos/${existing.bunnyVideoId}`, { method: 'DELETE' })
        .catch((err) => console.warn('[reel-reject] Bunny delete failed (non-fatal):', err.message))
    }

    // Clear bunnyVideoId so creator must upload a new video to resubmit
    const reel = await Reel.findByIdAndUpdate(
      req.params.id,
      { $set: { submissionStatus: 'rejected', isPublished: false, rejectionReason: safeReason, bunnyVideoId: '' } },
      { new: true }
    ).lean()

    logAdminAction(req, 'reject_reel', 'reel', reel._id, reel.title || reel._id.toString(), { reason: safeReason })
    res.json({ success: true, reel })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/admin/reels/:id
 * Soft-deletes a reel and unpublishes it.
 */
router.delete('/reels/:id', async (req, res, next) => {
  try {
    const existing = await Reel.findById(req.params.id).select('bunnyVideoId title').lean()
    if (!existing) return res.status(404).json({ error: 'Reel not found' })

    const reel = await Reel.findByIdAndUpdate(
      req.params.id,
      { $set: { isDeleted: true, isPublished: false, bunnyVideoId: '' } },
      { new: true }
    ).lean()

    if (existing.bunnyVideoId) {
      bunnyRequest(`/library/${libraryId}/videos/${existing.bunnyVideoId}`, { method: 'DELETE' })
        .catch((err) => console.warn('[reel-delete] Bunny delete failed (non-fatal):', err.message))
    }

    logAdminAction(req, 'delete_reel', 'reel', reel._id, reel.title || reel._id.toString())
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/admin/audit-log
 * Returns recent admin actions. Query: ?action=&targetType=&page=
 */
router.get('/audit-log', async (req, res, next) => {
  try {
    const { action, targetType, page = 1 } = req.query
    const limit  = 50
    const filter = {}
    if (action)     filter.action     = action
    if (targetType) filter.targetType = targetType

    const [actions, total] = await Promise.all([
      AdminAction.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * limit)
        .limit(limit)
        .lean(),
      AdminAction.countDocuments(filter),
    ])

    res.json({ actions, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

export default router

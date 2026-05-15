import express, { Router } from 'express'
import { Content } from '../models/Content.js'
import { CuratedShelf } from '../models/CuratedShelf.js'
import { StreamCollection } from '../models/StreamCollection.js'
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
import { SUPPORTED_PROVIDERS, getProviderStatus } from '../providers/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID
const accessKey = process.env.BUNNY_STREAM_API_KEY

async function bunnyRequest(path, { method = 'GET', body, headers = {} } = {}) {
  if (!libraryId || !accessKey) {
    throw new Error('Bunny Stream is not configured. Set BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY.')
  }

  const res = await fetch(`https://video.bunnycdn.com${path}`, {
    method,
    headers: {
      AccessKey: accessKey,
      ...headers,
    },
    body,
  })

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!res.ok) {
    throw new Error(typeof data === 'string' ? data : data?.message || `Bunny API HTTP ${res.status}`)
  }

  return data
}

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

async function syncProcessingJob(job) {
  if (!job.bunnyVideoId || !['processing', 'uploading', 'queued'].includes(job.status)) return job

  try {
    const video = await bunnyRequest(`/library/${libraryId}/videos/${job.bunnyVideoId}`)
    const encodeProgress = Number(video?.encodeProgress || 0)
    const isReady = encodeProgress >= 100

    const nextStatus = isReady ? 'ready' : 'processing'
    const nextProgress = isReady ? 100 : Math.max(70, Math.min(99, Math.round(70 + encodeProgress * 0.29)))

    const updated = await UploadJob.findByIdAndUpdate(
      job._id,
      {
        $set: {
          status: nextStatus,
          progress: nextProgress,
          note: isReady ? 'Video is ready to stream.' : 'Bunny is transcoding your video.',
          error: '',
        },
      },
      { new: true }
    )

    if (isReady && updated?.contentId) {
      if (updated.episodeNumber) {
        // Try to update an existing episode entry first
        const linked = await Content.findOneAndUpdate(
          { _id: updated.contentId, 'episodes.number': updated.episodeNumber },
          { $set: { 'episodes.$.bunnyVideoId': updated.bunnyVideoId } },
          { new: true }
        )
        // Episode didn't exist yet — push a new one
        if (!linked) {
          await Content.findByIdAndUpdate(updated.contentId, {
            $push: {
              episodes: {
                number:      updated.episodeNumber,
                title:       updated.episodeTitle    || `Episode ${updated.episodeNumber}`,
                duration:    updated.episodeDuration || '',
                bunnyVideoId: updated.bunnyVideoId,
              },
            },
          })
        }
      } else {
        // Film / Documentary — link to root bunnyVideoId
        await Content.findByIdAndUpdate(updated.contentId, { $set: { bunnyVideoId: updated.bunnyVideoId } })
      }
    }

    return updated || job
  } catch {
    return job
  }
}

async function processUploadJob(jobId, fileBuffer) {
  try {
    const job = await UploadJob.findById(jobId)
    if (!job) return

    await UploadJob.findByIdAndUpdate(jobId, {
      $set: { status: 'uploading', progress: 20, note: 'Creating video in Bunny Stream...', error: '' },
    })

    const created = await bunnyRequest(`/library/${libraryId}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: job.title,
        collectionId: job.bunnyCollectionId,
      }),
    })

    const bunnyVideoId = created?.guid
    if (!bunnyVideoId) throw new Error('Bunny did not return a video ID.')

    await UploadJob.findByIdAndUpdate(jobId, {
      $set: {
        bunnyVideoId,
        progress: 45,
        note: 'Uploading source file to Bunny Stream...',
      },
    })

    await bunnyRequest(`/library/${libraryId}/videos/${bunnyVideoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileBuffer,
    })

    await UploadJob.findByIdAndUpdate(jobId, {
      $set: {
        status: 'processing',
        progress: 70,
        note: 'Upload complete. Bunny is transcoding...',
      },
    })
  } catch (err) {
    await UploadJob.findByIdAndUpdate(jobId, {
      $set: {
        status: 'failed',
        progress: 0,
        error: err?.message || 'Upload failed',
      },
    })
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

        const content = await Content.create({
          title:        video.title || 'Untitled',
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

router.get('/content', async (req, res, next) => {
  try {
    const items = await Content.find()
      .sort({ updatedAt: -1 })
      .limit(100)
      .select('title type bunnyVideoId isPremium isFeatured isPublished releaseYear rating genre badge')
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
      contentWarnings = '', moodTags = [], badge = null,
      isPremium = false, isFeatured = false, episodes = [],
    } = req.body

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
    if (!['Film', 'Series', 'Documentary'].includes(type)) {
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
      contentLanguage: contentLanguage || 'Bengali',
      certification:   certification || null,
      contentWarnings: contentWarnings?.trim() || '',
      moodTags:        Array.isArray(moodTags) ? moodTags : [],
      badge:           badge || null,
      isPremium:       Boolean(isPremium),
      isFeatured:      Boolean(isFeatured),
      isPublished:     false,
      submissionStatus: 'approved',
      episodes: type === 'Series' && Array.isArray(episodes)
        ? episodes
            .filter((ep) => ep.number && ep.title)
            .map((ep) => ({
              number:      Number(ep.number),
              title:       String(ep.title).trim(),
              duration:    String(ep.duration || '').trim(),
              bunnyVideoId: '',
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
  'posterUrl', 'backdropUrl', 'palette',
  'contentLanguage', 'certification', 'contentWarnings', 'moodTags', 'reviewCount',
  'episodes',
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

    const item = await Content.findById(req.params.id).select('bunnyVideoId type episodes isPublished').lean()
    if (!item) return res.status(404).json({ error: 'Content not found' })

    if (publish) {
      const hasVideo = item.type === 'Series'
        ? item.episodes?.length > 0 && item.episodes.some((ep) => ep.bunnyVideoId)
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
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.post('/map-existing-video', async (req, res, next) => {
  try {
    const { contentId, bunnyVideoId } = req.body
    if (!contentId || !bunnyVideoId) {
      return res.status(400).json({ error: 'contentId and bunnyVideoId are required' })
    }

    const content = await Content.findByIdAndUpdate(
      contentId,
      { $set: { bunnyVideoId: String(bunnyVideoId).trim() } },
      { new: true }
    ).select('title bunnyVideoId type').lean()

    if (!content) return res.status(404).json({ error: 'Content not found' })

    res.json({
      success: true,
      content,
      message: `Mapped Bunny video ${content.bunnyVideoId} to ${content.title}.`,
    })
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
      contentId      = null,
      episodeNumber  = null,
      episodeTitle   = '',
      episodeDuration = '',
    } = req.body

    if (!title || !collectionId) {
      return res.status(400).json({ error: 'title and collectionId are required' })
    }

    const collection = await StreamCollection.findById(collectionId).lean()
    if (!collection || !collection.isActive) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    const job = await UploadJob.create({
      createdByEmail:  req.user.email,
      title:           title.trim(),
      collectionId:    collection._id,
      collectionName:  collection.name,
      bunnyCollectionId: collection.bunnyCollectionId,
      contentId,
      episodeNumber:   episodeNumber   ? Number(episodeNumber)      : null,
      episodeTitle:    episodeTitle    ? String(episodeTitle).trim() : '',
      episodeDuration: episodeDuration ? String(episodeDuration).trim() : '',
      status:   'awaiting_file',
      progress: 0,
      note:     'Upload job created. Waiting for file bytes.',
    })

    res.status(201).json(job)
  } catch (err) {
    next(err)
  }
})

router.put('/upload-jobs/:id/file', express.raw({ type: 'application/octet-stream', limit: '1024mb' }), async (req, res, next) => {
  try {
    const job = await UploadJob.findById(req.params.id)
    if (!job) return res.status(404).json({ error: 'Upload job not found' })
    if (job.status !== 'awaiting_file') {
      return res.status(409).json({ error: `Job is already in "${job.status}" state` })
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Binary file body is required' })
    }

    const fileName = String(req.headers['x-file-name'] || '').slice(0, 240)
    await UploadJob.findByIdAndUpdate(job._id, {
      $set: {
        status: 'queued',
        progress: 10,
        note: 'File received. Queued for Bunny upload.',
        fileName,
      },
    })

    const fileBuffer = Buffer.from(req.body)
    setImmediate(() => {
      void processUploadJob(job._id, fileBuffer)
    })

    res.status(202).json({ success: true, jobId: job._id, message: 'File accepted and queued for async upload.' })
  } catch (err) {
    next(err)
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
    // Fire-and-forget — email failure must never block the API response
    emailCreatorApproved(user.creatorProfile?.studioName || user.displayName, user.email)
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
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: { creatorStatus: 'rejected', isCreator: false, creatorRejectionReason: reason.trim(), creatorRejectedAt: new Date() } },
      { new: true }
    ).select('email displayName creatorStatus isCreator creatorProfile')

    if (!user) return res.status(404).json({ error: 'User not found' })
    emailCreatorRejected(user.creatorProfile?.studioName || user.displayName, user.email, reason)
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
      )
    }

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

    const content = await Content.findOneAndUpdate(
      { _id: req.params.id, creatorId: { $ne: null } },
      { $set: { submissionStatus: 'rejected', rejectionReason: reason.trim() } },
      { new: true }
    ).populate('creatorId', 'email displayName creatorProfile').lean()

    if (!content) return res.status(404).json({ error: 'Submission not found' })

    if (content.creatorId) {
      const creator = content.creatorId
      emailSubmissionRejected(
        creator.creatorProfile?.studioName || creator.displayName,
        creator.email,
        content.title,
        reason
      )
    }

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

    // All approved creator content (excludes admin-uploaded content with null creatorId)
    const pieces = await Content
      .find({ submissionStatus: 'approved', creatorId: { $ne: null } })
      .select('_id title creatorId viewCount viewCountSnapshot')
      .lean()

    // Fetch total views per creator for tier calculation
    const creatorViewTotals = new Map()
    for (const p of pieces) {
      const cid = String(p.creatorId)
      creatorViewTotals.set(cid, (creatorViewTotals.get(cid) ?? 0) + (p.viewCount ?? 0))
    }

    let created = 0, skipped = 0
    const ops = []

    for (const piece of pieces) {
      const monthlyViews = (piece.viewCount ?? 0) - (piece.viewCountSnapshot ?? 0)
      if (monthlyViews <= 0) { skipped++; continue }

      // Skip if already calculated for this period
      const exists = await CreatorEarning.exists({ contentId: piece._id, year, month })
      if (exists) { skipped++; continue }

      const creatorTotalViews = creatorViewTotals.get(String(piece.creatorId)) ?? 0
      const tier              = tierFor(creatorTotalViews)
      const grossPaise        = monthlyViews * rate
      const netPaise          = Math.round(grossPaise * (tier.share / 100))

      ops.push(
        CreatorEarning.create({
          creatorId:        piece.creatorId,
          contentId:        piece._id,
          month, year,
          viewCount:        monthlyViews,
          ratePerViewPaise: rate,
          grossAmountPaise: grossPaise,
          revenueSharePct:  tier.share,
          netAmountPaise:   netPaise,
          status:           'pending',
          calculatedAt:     new Date(),
        }).then(() => {
          // Advance snapshot so next month starts from here
          return Content.findByIdAndUpdate(piece._id, { viewCountSnapshot: piece.viewCount })
        })
      )
      created++
    }

    await Promise.all(ops)

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
    const todayStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo   = new Date(Date.now() - 7   * 86_400_000)
    const thirtyDaysAgo  = new Date(Date.now() - 30  * 86_400_000)
    const sixMonthsAgo   = new Date(Date.now() - 180 * 86_400_000)
    const twentyFourHAgo = new Date(Date.now() - 86_400_000)
    const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1)

    const [
      // ── existing ───────────────────────────────────────────────────────────
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
      // ── new ───────────────────────────────────────────────────────────────
      pendingApplications,
      pendingSubmissions,
      paymentTodayAgg,
      lastSuccessfulPayment,
      topContentAgg,
      deviceAgg,
      geoAgg,
    ] = await Promise.all([

      UploadJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

      UploadJob.find({ status: 'failed' })
        .sort({ updatedAt: -1 }).limit(5)
        .select('title episodeNumber error updatedAt').lean(),

      UploadJob.find({ status: { $in: ['uploading', 'processing'] } })
        .sort({ updatedAt: -1 }).limit(10)
        .select('title episodeNumber status progress updatedAt').lean(),

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
        { $match: { isPublished: true } },
        { $group: {
          _id:            null,
          total:          { $sum: 1 },
          totalViews:     { $sum: '$viewCount' },
          addedThisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, 1, 0] } },
        }},
      ]),

      // ── NEW: Creator action queue — straight from User + Content models ────
      User.countDocuments({ creatorStatus: 'applied' }),
      Content.countDocuments({ submissionStatus: 'pending', isPublished: false }),

      // ── NEW: Payment health today — from Transaction ───────────────────────
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
        { $unwind: { path: '$c', preserveNullAndEmpty: false } },
        { $project: { title: '$c.title', type: '$c.type', views: 1 } },
      ]),

      // ── NEW: Device breakdown last 7 days — from ViewEvent ────────────────
      ViewEvent.aggregate([
        { $match: { viewedAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // ── NEW: Top 5 states last 7 days — from ViewEvent ────────────────────
      ViewEvent.aggregate([
        { $match: { viewedAt: { $gte: sevenDaysAgo }, country: 'IN' } },
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
          title: j.episodeNumber ? `Ep ${j.episodeNumber} — ${j.title}` : j.title,
          error: j.error || 'Unknown error',
          ago:   j.updatedAt,
        })),
        processing: processingJobs.map(j => ({
          title:    j.episodeNumber ? `Ep ${j.episodeNumber} — ${j.title}` : j.title,
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

export default router

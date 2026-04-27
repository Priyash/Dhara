import express, { Router } from 'express'
import { Content } from '../models/Content.js'
import { StreamCollection } from '../models/StreamCollection.js'
import { UploadJob } from '../models/UploadJob.js'
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
      await Content.findByIdAndUpdate(updated.contentId, { $set: { bunnyVideoId: updated.bunnyVideoId } })
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
      .select('title type bunnyVideoId isPremium isFeatured releaseYear rating genre badge')
      .lean()
    res.json(items)
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
  'title', 'subtitle', 'desc', 'type', 'genre', 'cast', 'director',
  'releaseYear', 'rating', 'isPremium', 'isFeatured', 'badge',
  'posterUrl', 'backdropUrl', 'palette',
  'contentLanguage', 'certification', 'reviewCount',
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
    res.json(item)
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
    const { title, collectionId, contentId = null } = req.body
    if (!title || !collectionId) {
      return res.status(400).json({ error: 'title and collectionId are required' })
    }

    const collection = await StreamCollection.findById(collectionId).lean()
    if (!collection || !collection.isActive) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    const job = await UploadJob.create({
      createdByEmail: req.user.email,
      title: title.trim(),
      collectionId: collection._id,
      collectionName: collection.name,
      bunnyCollectionId: collection.bunnyCollectionId,
      contentId,
      status: 'awaiting_file',
      progress: 0,
      note: 'Upload job created. Waiting for file bytes.',
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

export default router

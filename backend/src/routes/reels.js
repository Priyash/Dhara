import { Router } from 'express'
import { createRequire } from 'module'
import { pipeline } from 'stream/promises'
import { createWriteStream, createReadStream, unlink } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Reel } from '../models/Reel.js'
import { User } from '../models/User.js'
import { Comment, COMMENT_MAX_LENGTH } from '../models/Comment.js'
import { ViewEvent } from '../models/ViewEvent.js'
import { StreamCollection } from '../models/StreamCollection.js'
import { UploadJob } from '../models/UploadJob.js'
import { requireAuth } from '../middleware/auth.js'

// Optional auth — attaches req.user when a valid token is present, proceeds without it if not.
async function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return next()
  try {
    const { admin: fbAdmin } = await import('../config/firebase.js')
    const { User: UserModel }  = await import('../models/User.js')
    const decoded = await fbAdmin.auth().verifyIdToken(token, true)
    req.firebaseUser = decoded
    req.user = await UserModel.findOne({ firebaseUid: decoded.uid })
      .select('_id firebaseUid email isCreator creatorStatus subscriptionStatus')
  } catch { /* stale or missing token — continue as anonymous */ }
  next()
}
import { buildHlsUrl } from './reels.helpers.js'
import { processUploadJob } from '../services/bunnyUpload.js'

const _require = createRequire(import.meta.url)
const geoip    = _require('geoip-lite')

const IN_STATES = {
  AN: 'Andaman & Nicobar', AP: 'Andhra Pradesh',   AR: 'Arunachal Pradesh',
  AS: 'Assam',             BR: 'Bihar',             CH: 'Chandigarh',
  CT: 'Chhattisgarh',      DL: 'Delhi',             DN: 'Dadra & Nagar Haveli',
  GA: 'Goa',               GJ: 'Gujarat',           HP: 'Himachal Pradesh',
  HR: 'Haryana',           JH: 'Jharkhand',         JK: 'J&K',
  KA: 'Karnataka',         KL: 'Kerala',            LA: 'Ladakh',
  LD: 'Lakshadweep',       MH: 'Maharashtra',       ML: 'Meghalaya',
  MN: 'Manipur',           MP: 'Madhya Pradesh',    MZ: 'Mizoram',
  NL: 'Nagaland',          OR: 'Odisha',            PB: 'Punjab',
  PY: 'Puducherry',        RJ: 'Rajasthan',         SK: 'Sikkim',
  TG: 'Telangana',         TN: 'Tamil Nadu',        TR: 'Tripura',
  UP: 'Uttar Pradesh',     UT: 'Uttarakhand',       WB: 'West Bengal',
}

const router = Router()

const VIEW_MIN_POSITION_SECS = 5
const VIEW_DEDUP_WINDOW_MS   = 24 * 60 * 60 * 1000

const REEL_COLLECTION_SLUG = process.env.REEL_COLLECTION_SLUG || 'dhara-reels'

const PUBLIC_FIELDS = '-bunnyVideoId'

// ── Feed ─────────────────────────────────────────────────────────────────────

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page,  10) || 1)
    const limit   = Math.min(40, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const hashtag = (req.query.hashtag || '').trim().toLowerCase().replace(/^#/, '')
    const sort    = req.query.sort === 'trending' ? { viewCount: -1, createdAt: -1 } : { createdAt: -1 }

    const filter = { isPublished: true, isDeleted: { $ne: true }, submissionStatus: 'approved' }
    if (hashtag) filter.hashtags = hashtag

    const [items, total] = await Promise.all([
      Reel.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .select(PUBLIC_FIELDS)
        .populate('creatorId', 'displayName creatorProfile.studioName photoURL')
        .lean(),
      Reel.countDocuments(filter),
    ])

    res.json({ items, total, page, pages: Math.ceil(total / limit), limit })
  } catch (err) {
    next(err)
  }
})

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * GET /api/reels/search?q=comedy
 * Auth required. Searches published approved reels by title and hashtags.
 * A '#' prefix targets hashtags only (e.g. ?q=#comedy).
 */
router.get('/search', optionalAuth, async (req, res, next) => {
  try {
    const raw = (req.query.q || '').trim()
    if (raw.length < 2) return res.json([])

    const filter = { isPublished: true, isDeleted: { $ne: true }, submissionStatus: 'approved' }

    // '#comedy' → hashtag-only search; 'comedy' → title + hashtag
    if (raw.startsWith('#')) {
      const tag = raw.slice(1).toLowerCase()
      filter.hashtags = { $regex: tag, $options: 'i' }
    } else {
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.$or = [
        { title:    { $regex: escaped, $options: 'i' } },
        { hashtags: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ]
    }

    const reels = await Reel.find(filter)
      .sort({ viewCount: -1, createdAt: -1 })
      .limit(20)
      .select(PUBLIC_FIELDS)
      .populate('creatorId', 'displayName creatorProfile.studioName photoURL')
      .lean()

    res.json(reels)
  } catch (err) {
    next(err)
  }
})

// ── Hashtags ──────────────────────────────────────────────────────────────────

/**
 * GET /api/reels/hashtags?limit=20&q=comedy
 * Returns the most-used hashtags across all published reels, aggregated server-side.
 * Must be registered BEFORE /:id to avoid the literal "hashtags" being treated as an ID.
 */
router.get('/hashtags', async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)))
    const q     = String(req.query.q || '').toLowerCase().trim()

    const matchBase = { isPublished: true, isDeleted: { $ne: true }, submissionStatus: 'approved' }

    const agg = [
      { $match: matchBase },
      { $unwind: '$hashtags' },
    ]
    if (q) agg.push({ $match: { hashtags: { $regex: q, $options: 'i' } } })
    agg.push(
      { $group: { _id: { $toLower: '$hashtags' }, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
      { $project: { _id: 0, tag: '$_id', count: 1 } }
    )

    const tags = await Reel.aggregate(agg)
    res.json(tags)
  } catch (err) {
    next(err)
  }
})

// ── Single reel ───────────────────────────────────────────────────────────────

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const reel = await Reel.findOne({
      _id: req.params.id, isPublished: true, isDeleted: { $ne: true }, submissionStatus: 'approved',
    })
      .select(PUBLIC_FIELDS)
      .populate('creatorId', 'displayName creatorProfile.studioName photoURL')
      .lean()

    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    res.json(reel)
  } catch (err) {
    next(err)
  }
})

router.get('/:id/stream', requireAuth, async (req, res, next) => {
  try {
    const reel = await Reel.findById(req.params.id)
      .select('bunnyVideoId isPublished isDeleted submissionStatus creatorId')
      .lean()

    if (!reel) return res.status(404).json({ error: 'Reel not found' })

    const isOwn    = reel.creatorId && req.user._id.toString() === reel.creatorId.toString()
    const isHidden = !reel.isPublished || reel.isDeleted || reel.submissionStatus !== 'approved'
    if (isHidden && !isOwn) return res.status(404).json({ error: 'Reel not found' })

    let { bunnyVideoId } = reel
    if (!bunnyVideoId) {
      // Self-heal: recover bunnyVideoId from the associated UploadJob if the Reel was
      // approved before the pipeline backfilled the field (pre-existing uploads).
      const job = await UploadJob.findOne({
        reelId:       reel._id,
        bunnyVideoId: { $exists: true, $ne: '' },
      }).select('bunnyVideoId').lean()
      if (job?.bunnyVideoId) {
        bunnyVideoId = job.bunnyVideoId
        const healUpdates = { bunnyVideoId }
        if (!reel.thumbnailUrl) {
          const pullZone = process.env.BUNNY_CDN_PULL_ZONE || ''
          if (pullZone) healUpdates.thumbnailUrl = `https://${pullZone}/${bunnyVideoId}/thumbnail.jpg`
        }
        Reel.updateOne({ _id: reel._id }, { $set: healUpdates }).catch(() => {})
      }
    }

    if (!bunnyVideoId) return res.status(404).json({ error: 'Video not ready yet' })

    res.json({ hlsUrl: buildHlsUrl(bunnyVideoId) })
  } catch (err) {
    next(err)
  }
})

// ── Engagement ────────────────────────────────────────────────────────────────

router.post('/:id/view', requireAuth, async (req, res, next) => {
  try {
    const positionSecs = Number(req.body.positionSecs ?? 0)
    if (positionSecs < VIEW_MIN_POSITION_SECS) {
      return res.status(400).json({ error: `positionSecs must be ≥ ${VIEW_MIN_POSITION_SECS}`, code: 'INSUFFICIENT_PLAYBACK' })
    }

    const reel = await Reel.findOne({
      _id: req.params.id, isPublished: true, isDeleted: { $ne: true }, submissionStatus: 'approved',
    }).select('creatorId').lean()

    if (!reel) return res.status(404).json({ error: 'Reel not found' })

    const dedupSince = new Date(Date.now() - VIEW_DEDUP_WINDOW_MS)
    const already    = await ViewEvent.exists({
      userId: req.user._id, contentId: req.params.id, episodeNumber: null,
      viewedAt: { $gte: dedupSince },
    })
    if (already) return res.json({ ok: true, counted: false })

    const updated = await Reel.findByIdAndUpdate(
      req.params.id, { $inc: { viewCount: 1 } }, { new: true }
    ).select('viewCount likeCount commentCount').lean()

    res.json({ ok: true, counted: true, stats: updated })

    const now    = new Date()
    const rawIp  = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || ''
    const geo    = geoip.lookup(rawIp) || {}
    const ua     = req.headers['user-agent'] || ''
    const device = /smart-tv|webos|tizen|roku|firetv|tv/i.test(ua) ? 'tv'
      : /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop'
    const state  = geo.country === 'IN' && geo.region
      ? (IN_STATES[geo.region] || geo.region) : (geo.country || 'Unknown')

    ViewEvent.create({
      contentId: req.params.id, episodeNumber: null,
      creatorId: reel.creatorId, userId: req.user._id,
      viewedAt: now, hour: now.getHours(), dayOfWeek: now.getDay(),
      state, city: geo.city || 'Unknown', country: geo.country || 'Unknown', device,
    }).catch((err) => console.error('[reel-view-event]', err.message))
  } catch (err) {
    next(err)
  }
})

router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const reelId = String(req.params.id)
    const userId = req.user._id

    const userDoc      = await User.findById(userId).select('likedContent').lean()
    const alreadyLiked = (userDoc?.likedContent ?? []).includes(reelId)

    // $addToSet and $push on the same field in one update causes a MongoDB conflict error.
    // Use $addToSet only (idempotent), then apply the cap as a separate update.
    const userUpdate = alreadyLiked
      ? { $pull: { likedContent: reelId } }
      : { $addToSet: { likedContent: reelId } }

    const [reel, user] = await Promise.all([
      Reel.findByIdAndUpdate(reelId, { $inc: { likeCount: alreadyLiked ? -1 : 1 } }, { new: true })
        .select('likeCount commentCount viewCount').lean(),
      User.findByIdAndUpdate(userId, userUpdate, { new: true })
        .select('likedContent').lean(),
    ])

    // Trim likedContent to last 2000 entries in a separate step (avoids conflict with $addToSet)
    if (!alreadyLiked) {
      User.findByIdAndUpdate(userId, {
        $push: { likedContent: { $each: [], $slice: -2000 } },
      }).catch(() => {})
    }

    if (!reel) return res.status(404).json({ error: 'Reel not found' })

    res.json({
      liked:     (user.likedContent ?? []).includes(reelId),
      likeCount: Math.max(0, reel.likeCount),
      stats:     { viewCount: reel.viewCount, likeCount: Math.max(0, reel.likeCount), commentCount: reel.commentCount },
    })
  } catch (err) {
    next(err)
  }
})

// ── Comments ──────────────────────────────────────────────────────────────────

router.get('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const filter = { reelId: req.params.id, isDeleted: false }
    const [comments, total] = await Promise.all([
      Comment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('userId', 'displayName photoURL').lean(),
      Comment.countDocuments(filter),
    ])
    res.json({ comments, total, page, pages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const text = String(req.body.text || '').trim()
    if (!text) return res.status(400).json({ error: 'Comment text is required' })
    if (text.length > COMMENT_MAX_LENGTH) {
      return res.status(400).json({ error: `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer` })
    }
    const reel = await Reel.findOne({
      _id: req.params.id, isPublished: true, isDeleted: { $ne: true }, submissionStatus: 'approved',
    }).lean()
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    const comment = await Comment.create({ reelId: req.params.id, userId: req.user._id, text })
    await Reel.findByIdAndUpdate(req.params.id, { $inc: { commentCount: 1 } })
    const populated = await comment.populate('userId', 'displayName photoURL')
    res.status(201).json(populated)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id/comments/:commentId', requireAuth, async (req, res, next) => {
  try {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase())
    const isAdmin = adminEmails.includes((req.user.email || '').toLowerCase())

    // Atomic delete — filtering on isDeleted:{$ne:true} means only one of two
    // concurrent delete requests for the same comment can match, so
    // commentCount can't be double-decremented.
    const comment = await Comment.findOneAndUpdate(
      { _id: req.params.commentId, isDeleted: { $ne: true }, ...(isAdmin ? {} : { userId: req.user._id }) },
      { $set: { isDeleted: true } }
    )

    if (!comment) {
      const existing = await Comment.findById(req.params.commentId).select('isDeleted').lean()
      if (!existing || existing.isDeleted) return res.status(404).json({ error: 'Comment not found' })
      return res.status(403).json({ error: 'Cannot delete this comment' })
    }

    await Reel.findByIdAndUpdate(req.params.id, { $inc: { commentCount: -1 } })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// ── Creator upload ────────────────────────────────────────────────────────────

router.post('/:id/upload-job', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isCreator || req.user.creatorStatus !== 'approved') {
      return res.status(403).json({ error: 'Creator access required' })
    }
    const reel = await Reel.findOne({ _id: req.params.id, creatorId: req.user._id }).lean()
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    if (reel.submissionStatus === 'approved') {
      return res.status(400).json({ error: 'Live reels cannot be re-uploaded.', code: 'REEL_ALREADY_LIVE' })
    }
    const collection = await StreamCollection.findOne({ slug: REEL_COLLECTION_SLUG, isActive: true }).lean()
    if (!collection) {
      return res.status(503).json({
        error: `Reel upload collection not configured. An admin must create a Bunny collection with slug "${REEL_COLLECTION_SLUG}".`,
        code:  'REEL_COLLECTION_NOT_FOUND',
      })
    }
    const existing = await UploadJob.findOne({ reelId: reel._id, status: 'awaiting_file' }).lean()
    if (existing) return res.json(existing)
    const job = await UploadJob.create({
      createdByEmail:    req.user.email,
      title:             reel.title || `Reel-${reel._id}`,
      collectionId:      collection._id,
      collectionName:    collection.name,
      bunnyCollectionId: collection.bunnyCollectionId,
      reelId:            reel._id,
      status:            'awaiting_file',
      progress:          0,
      note:              'Upload job created. Waiting for file bytes.',
    })
    res.status(201).json(job)
  } catch (err) {
    next(err)
  }
})

router.get('/:id/upload-job', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isCreator || req.user.creatorStatus !== 'approved') {
      return res.status(403).json({ error: 'Creator access required' })
    }
    const reel = await Reel.findOne({ _id: req.params.id, creatorId: req.user._id }).select('_id').lean()
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    const job = await UploadJob.findOne({ reelId: reel._id })
      .sort({ createdAt: -1 })
      .select('status progress note error')
      .lean()
    if (!job) return res.status(404).json({ error: 'No upload job found' })
    res.json(job)
  } catch (err) {
    next(err)
  }
})

router.put('/:id/file', requireAuth, async (req, res, next) => {
  let tmpPath = null
  try {
    if (!req.user.isCreator || req.user.creatorStatus !== 'approved') {
      return res.status(403).json({ error: 'Creator access required' })
    }

    // Stream body to disk first — avoids holding up to 512 MB in RAM per upload.
    tmpPath = join(tmpdir(), `dhara-reel-${randomUUID()}.tmp`)
    const contentLength = parseInt(req.headers['content-length'] || '0', 10)
    await pipeline(req, createWriteStream(tmpPath))

    const reel = await Reel.findOne({ _id: req.params.id, creatorId: req.user._id }).lean()
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    const job = await UploadJob.findOne({ reelId: reel._id, status: 'awaiting_file' })
    if (!job) {
      return res.status(409).json({ error: 'No pending upload job. Call POST /api/reels/:id/upload-job first.' })
    }

    const fileName = String(req.headers['x-file-name'] || '').slice(0, 240)
    await UploadJob.findByIdAndUpdate(job._id, {
      $set: { status: 'queued', progress: 10, note: 'File received. Queued for upload.', fileName },
    })

    const capturedTmpPath = tmpPath
    tmpPath = null // processUploadJob callback owns cleanup from here

    setImmediate(async () => {
      try {
        await processUploadJob(job._id, createReadStream(capturedTmpPath), contentLength)
      } catch { /* status already set to 'failed' by processUploadJob */ } finally {
        unlink(capturedTmpPath, () => {})
      }
    })

    res.status(202).json({ success: true, jobId: job._id, message: 'File accepted and queued.' })
  } catch (err) {
    next(err)
  } finally {
    if (tmpPath) unlink(tmpPath, () => {})
  }
})

export default router

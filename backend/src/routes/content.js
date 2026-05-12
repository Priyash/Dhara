import { Router } from 'express'
import { createHash } from 'crypto'
import { Content } from '../models/Content.js'
import { CuratedShelf } from '../models/CuratedShelf.js'
import { User } from '../models/User.js'
import { requireAuth, requireSubscription } from '../middleware/auth.js'

const router = Router()

/**
 * Builds a Bunny CDN HLS URL.
 * For premium content, appends a token signed with SHA-256 (Bunny Token Auth).
 *
 * Token formula (official Bunny spec):
 *   token = base64url( SHA256( TokenAuthKey + urlPath + expires ) )
 *   URL   = https://{pullZone}{path}?token={token}&expires={unix}
 *
 * Enable Token Authentication on the pull zone in the Bunny dashboard first.
 */
function buildHlsUrl(videoId, sign = false) {
  const pullZone = process.env.BUNNY_CDN_PULL_ZONE   // e.g. vz-abc123.b-cdn.net
  const path     = `/${videoId}/playlist.m3u8`
  const base     = `https://${pullZone}${path}`

  if (!sign) return base

  const expires = Math.floor(Date.now() / 1000) + 3600  // 1-hour window
  const key     = process.env.BUNNY_CDN_TOKEN_AUTH_KEY || ''

  const token = createHash('sha256')
    .update(key + path + expires)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return `${base}?token=${token}&expires=${expires}`
}

// Never send video GUIDs to public endpoints
const PUBLIC_FIELDS = '-bunnyVideoId -trailerVideoId -episodes.bunnyVideoId'

/**
 * GET /api/content
 * Public. Query: type, filter, sort
 */
router.get('/', async (req, res, next) => {
  try {
    const { type, filter, sort = 'rating' } = req.query
    const query = {}
    query.isPublished = true
    query.submissionStatus = { $nin: ['pending', 'rejected'] }

    if (type   && type   !== 'All') query.type     = type
    if (filter === 'Free')          query.isPremium = false
    if (filter === 'Premium')       query.isPremium = true
    if (filter === 'New')           query.badge     = 'NEW'

    const sortObj = sort === 'title' ? { title: 1 } : { rating: -1 }

    const items = await Content.find(query).sort(sortObj).select(PUBLIC_FIELDS).lean()
    res.json(items)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/content/featured
 * Public. Returns the title marked isFeatured=true (Hero section).
 * Must stay BEFORE /:id — otherwise Express casts "featured" as a MongoDB ObjectId → 500.
 */
router.get('/featured', async (req, res, next) => {
  try {
    const items = await Content.find({ isFeatured: true, isPublished: true, submissionStatus: { $nin: ['pending', 'rejected'] } })
      .select(PUBLIC_FIELDS)
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean()
    if (!items.length) return res.status(404).json({ error: 'No featured content set' })
    res.json(items)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/content/shelves
 * Public. Returns active curated shelves with populated (published) content.
 * Must be declared before /:id to avoid Express matching "shelves" as an id param.
 */
router.get('/shelves', async (req, res, next) => {
  try {
    const shelves = await CuratedShelf.find({ isActive: true })
      .sort({ displayOrder: 1 })
      .populate({
        path: 'contentIds',
        match: { isPublished: true },
        select: PUBLIC_FIELDS,
      })
      .lean()

    const result = shelves.map((s) => ({
      ...s,
      items: (s.contentIds || []).filter(Boolean),
    }))
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/content/:id
 * Public. Full metadata, no video GUIDs.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const item = await Content.findOne({ _id: req.params.id, isPublished: true, submissionStatus: { $nin: ['pending', 'rejected'] } }).select(PUBLIC_FIELDS).lean()
    if (!item) return res.status(404).json({ error: 'Content not found' })
    res.json(item)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/content/:id/stream
 * Auth required. Premium also requires active subscription.
 * Returns signed HLS URL for premium, unsigned for free.
 * The client's HLS.js fetches the manifest directly from Bunny CDN — this server
 * is never in the video data path.
 */
router.get('/:id/stream', requireAuth, async (req, res, next) => {
  try {
    const item = await Content.findById(req.params.id)
      .select('isPremium bunnyVideoId submissionStatus isPublished creatorId')
      .lean()

    if (!item)              return res.status(404).json({ error: 'Content not found' })
    if (!item.bunnyVideoId) return res.status(404).json({ error: 'No video attached to this title' })

    const isOwnContent = item?.creatorId && req.user?._id?.toString() === item.creatorId.toString()
    const isHidden = ['pending', 'rejected'].includes(item?.submissionStatus) || !item.isPublished
    if (isHidden && !isOwnContent) {
      return res.status(404).json({ error: 'Content not found' })
    }

    if (item.isPremium) {
      return requireSubscription(req, res, () => {
        res.json({ hlsUrl: buildHlsUrl(item.bunnyVideoId, true) })
      })
    }

    res.json({ hlsUrl: buildHlsUrl(item.bunnyVideoId, false) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/content/:id/view
 * No auth required. Increments viewCount atomically.
 * Optionally increments episode viewCount when episodeNumber is provided.
 */
router.post('/:id/view', async (req, res, next) => {
  try {
    const { episodeNumber } = req.body
    if (episodeNumber != null) {
      await Content.findByIdAndUpdate(
        req.params.id,
        { $inc: { viewCount: 1, 'episodes.$[ep].viewCount': 1 } },
        { arrayFilters: [{ 'ep.number': Number(episodeNumber) }] }
      )
    } else {
      await Content.findByIdAndUpdate(req.params.id, { $inc: { viewCount: 1 } })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/content/:id/like
 * Auth required. Toggles the current user's like on a piece of content.
 * Switching from dislike → like decrements dislikeCount atomically.
 * Returns updated counts and the caller's new like/dislike state.
 */
router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const contentId = String(req.params.id)
    const userId    = req.user._id

    const alreadyLiked    = (req.user.likedContent    ?? []).includes(contentId)
    const alreadyDisliked = (req.user.dislikedContent ?? []).includes(contentId)

    const contentInc = alreadyLiked
      ? { likeCount: -1 }
      : { likeCount: 1, ...(alreadyDisliked ? { dislikeCount: -1 } : {}) }

    const userOp = alreadyLiked
      ? { $pull: { likedContent: contentId } }
      : { $addToSet: { likedContent: contentId }, $pull: { dislikedContent: contentId } }

    const [content, user] = await Promise.all([
      Content.findByIdAndUpdate(contentId, { $inc: contentInc }, { new: true })
        .select('likeCount dislikeCount').lean(),
      User.findByIdAndUpdate(userId, userOp, { new: true })
        .select('likedContent dislikedContent').lean(),
    ])

    if (!content) return res.status(404).json({ error: 'Content not found' })

    res.json({
      likeCount:    Math.max(0, content.likeCount),
      dislikeCount: Math.max(0, content.dislikeCount),
      liked:        (user.likedContent    ?? []).includes(contentId),
      disliked:     (user.dislikedContent ?? []).includes(contentId),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/content/:id/dislike
 * Auth required. Toggles the current user's dislike on a piece of content.
 * Switching from like → dislike decrements likeCount atomically.
 */
router.post('/:id/dislike', requireAuth, async (req, res, next) => {
  try {
    const contentId = String(req.params.id)
    const userId    = req.user._id

    const alreadyLiked    = (req.user.likedContent    ?? []).includes(contentId)
    const alreadyDisliked = (req.user.dislikedContent ?? []).includes(contentId)

    const contentInc = alreadyDisliked
      ? { dislikeCount: -1 }
      : { dislikeCount: 1, ...(alreadyLiked ? { likeCount: -1 } : {}) }

    const userOp = alreadyDisliked
      ? { $pull: { dislikedContent: contentId } }
      : { $addToSet: { dislikedContent: contentId }, $pull: { likedContent: contentId } }

    const [content, user] = await Promise.all([
      Content.findByIdAndUpdate(contentId, { $inc: contentInc }, { new: true })
        .select('likeCount dislikeCount').lean(),
      User.findByIdAndUpdate(userId, userOp, { new: true })
        .select('likedContent dislikedContent').lean(),
    ])

    if (!content) return res.status(404).json({ error: 'Content not found' })

    res.json({
      likeCount:    Math.max(0, content.likeCount),
      dislikeCount: Math.max(0, content.dislikeCount),
      liked:        (user.likedContent    ?? []).includes(contentId),
      disliked:     (user.dislikedContent ?? []).includes(contentId),
    })
  } catch (err) {
    next(err)
  }
})

export default router

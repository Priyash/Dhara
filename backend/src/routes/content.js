import { Router } from 'express'
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { Types } from 'mongoose'
import { Content } from '../models/Content.js'
import { CuratedShelf } from '../models/CuratedShelf.js'
import { User } from '../models/User.js'
import { ViewEvent } from '../models/ViewEvent.js'
import { UserRating } from '../models/UserRating.js'
import { requireAuth, requireSubscription } from '../middleware/auth.js'
import { withCache } from '../config/cache.js'

const _require = createRequire(import.meta.url)
const geoip    = _require('geoip-lite')

// ISO 3166-2:IN region codes → display names
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
 * Public. Query: type, filter, genre, sort, page, limit
 *
 * When `page` is supplied → paginated response { items, total, page, pages, limit }
 * When `page` is absent  → flat array (backward-compatible for Home.jsx)
 */
router.get('/', withCache(60), async (req, res, next) => {
  try {
    const { type, filter, genre, sort = 'rating', page, limit: rawLimit } = req.query

    const query = {
      isPublished:      true,
      submissionStatus: { $nin: ['pending', 'rejected'] },
    }

    // 'Live' is not a type enum value — it maps to badge:'LIVE'
    if (type === 'Live')            query.badge      = 'LIVE'
    else if (type && type !== 'All') query.type      = type

    if (filter === 'Free')          query.isPremium  = false
    if (filter === 'Premium')       query.isPremium  = true
    if (filter === 'New')           query.badge      = 'NEW'
    if (genre  && genre  !== 'All') query.genre      = genre  // genre[] array field — Mongo matches if element equals value

    const sortObj =
      sort === 'title'  ? { title: 1 } :
      sort === 'newest' ? { releaseYear: -1, createdAt: -1 } :
                          { rating: -1 }

    // ── Paginated mode ────────────────────────────────────────────────────────
    if (page != null) {
      const pageNum  = Math.max(1, parseInt(page,     10) || 1)
      const limitNum = Math.min(48, Math.max(1, parseInt(rawLimit, 10) || 24))
      const skip     = (pageNum - 1) * limitNum

      const [items, total] = await Promise.all([
        Content.find(query).sort(sortObj).skip(skip).limit(limitNum).select(PUBLIC_FIELDS).lean(),
        Content.countDocuments(query),
      ])

      return res.json({ items, total, page: pageNum, pages: Math.ceil(total / limitNum), limit: limitNum })
    }

    // ── Legacy flat-array mode (Home.jsx) ─────────────────────────────────────
    const items = await Content.find(query).sort(sortObj).select(PUBLIC_FIELDS).lean()
    res.json(items)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/content/genres
 * Public. Returns available genres with per-genre counts for the given type/filter combo.
 * Must be declared before /:id to avoid Express matching "genres" as an ObjectId.
 */
/**
 * GET /api/content/:id/trailer
 * Public. Returns the Bunny embed URL for the trailer if one is set.
 * Cached for 1 hour — trailers don't change often.
 * Must be before /:id to avoid "trailer" being cast as an ObjectId.
 */
router.get('/:id/trailer', withCache(3600), async (req, res, next) => {
  try {
    const item = await Content.findOne(
      { _id: req.params.id, isPublished: true },
      'trailerVideoId'
    ).lean()
    if (!item?.trailerVideoId) return res.status(404).json({ error: 'No trailer available' })

    const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID
    if (!libraryId) return res.status(404).json({ error: 'No trailer available' })

    res.json({
      hlsUrl:   buildHlsUrl(item.trailerVideoId, false),
      embedUrl: `https://iframe.mediadelivery.net/embed/${libraryId}/${item.trailerVideoId}?autoplay=true&muted=true&loop=false&preload=true`,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/content/:id/rate
 * Auth required. Body: { score: 1–5 }
 * Upserts the user's rating and recomputes the community average on Content.
 */
router.post('/:id/rate', requireAuth, async (req, res, next) => {
  try {
    const score = Number(req.body.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ error: 'Score must be an integer between 1 and 5' })
    }

    const contentId = req.params.id

    // Upsert this user's rating
    await UserRating.findOneAndUpdate(
      { userId: req.user._id, contentId },
      { $set: { score } },
      { upsert: true }
    )

    // Recompute aggregate from all ratings for this content
    const [agg] = await UserRating.aggregate([
      { $match: { contentId: new Types.ObjectId(contentId) } },
      { $group: { _id: null, sum: { $sum: '$score' }, count: { $sum: 1 } } },
    ])

    const communityRating      = agg ? Math.round((agg.sum / agg.count) * 10) / 10 : score
    const communityRatingCount = agg?.count ?? 1

    await Content.findByIdAndUpdate(contentId, {
      $set: { communityRating, communityRatingCount },
    })

    res.json({ communityRating, communityRatingCount, userScore: score })
  } catch (err) {
    next(err)
  }
})

router.get('/genres', withCache(300), async (req, res, next) => {
  try {
    const { type, filter } = req.query

    const match = {
      isPublished:      true,
      submissionStatus: { $nin: ['pending', 'rejected'] },
    }
    if (type === 'Live')             match.badge     = 'LIVE'
    else if (type && type !== 'All') match.type      = type
    if (filter === 'Free')           match.isPremium = false
    if (filter === 'Premium')        match.isPremium = true
    if (filter === 'New')            match.badge     = 'NEW'

    const facets = await Content.aggregate([
      { $match: match },
      { $unwind: '$genre' },
      { $group: { _id: '$genre', count: { $sum: 1 } } },
      { $sort:  { _id: 1 } },
    ])

    res.json(facets.map((f) => ({ genre: f._id, count: f.count })))
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/content/featured
 * Public. Returns the title marked isFeatured=true (Hero section).
 * Must stay BEFORE /:id — otherwise Express casts "featured" as a MongoDB ObjectId → 500.
 */
router.get('/featured', withCache(60), async (req, res, next) => {
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
router.get('/shelves', withCache(60), async (req, res, next) => {
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
      .select('isPremium bunnyVideoId submissionStatus isPublished creatorId episodes')
      .lean()

    if (!item) return res.status(404).json({ error: 'Content not found' })

    const isOwnContent = item?.creatorId && req.user?._id?.toString() === item.creatorId.toString()
    const isHidden = ['pending', 'rejected'].includes(item?.submissionStatus) || !item.isPublished
    if (isHidden && !isOwnContent) {
      return res.status(404).json({ error: 'Content not found' })
    }

    // For Series, resolve the per-episode bunnyVideoId when ?episode=N is supplied
    let videoId = item.bunnyVideoId
    const epNum = req.query.episode != null ? Number(req.query.episode) : null
    if (epNum != null && item.episodes?.length) {
      const ep = item.episodes.find((e) => e.number === epNum)
      if (ep?.bunnyVideoId) videoId = ep.bunnyVideoId
    }

    if (!videoId) return res.status(404).json({ error: 'No video attached to this title' })

    if (item.isPremium) {
      return requireSubscription(req, res, () => {
        res.json({ hlsUrl: buildHlsUrl(videoId, true) })
      })
    }

    res.json({ hlsUrl: buildHlsUrl(videoId, false) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/content/:id/view
 * No auth required. Increments viewCount atomically and logs a ViewEvent for analytics.
 * Optionally increments episode viewCount when episodeNumber is provided.
 */
router.post('/:id/view', async (req, res, next) => {
  try {
    const { episodeNumber } = req.body
    const id = req.params.id
    let doc

    if (episodeNumber != null) {
      doc = await Content.findByIdAndUpdate(
        id,
        { $inc: { viewCount: 1, 'episodes.$[ep].viewCount': 1 } },
        { arrayFilters: [{ 'ep.number': Number(episodeNumber) }], select: 'creatorId' }
      )
    } else {
      doc = await Content.findByIdAndUpdate(id, { $inc: { viewCount: 1 } }, { select: 'creatorId' })
    }

    res.json({ ok: true })

    // Fire-and-forget: log view event for creator analytics
    if (doc?.creatorId) {
      const now   = new Date()
      const rawIp = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || ''
      const geo   = geoip.lookup(rawIp) || {}
      const ua    = req.headers['user-agent'] || ''
      const device = /smart-tv|webos|tizen|roku|firetv|tv/i.test(ua) ? 'tv'
        : /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop'
      const state = geo.country === 'IN' && geo.region
        ? (IN_STATES[geo.region] || geo.region)
        : (geo.country || 'Unknown')

      ViewEvent.create({
        contentId:     id,
        episodeNumber: episodeNumber ?? null,
        creatorId:     doc.creatorId,
        viewedAt:      now,
        hour:          now.getHours(),
        dayOfWeek:     now.getDay(),
        state,
        city:          geo.city    || 'Unknown',
        country:       geo.country || 'Unknown',
        device,
      }).catch(() => {})
    }
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

    // Fetch only the reaction arrays — excluded from req.user for perf on every request
    const userReact = await User.findById(userId).select('likedContent dislikedContent').lean()
    const alreadyLiked    = (userReact?.likedContent    ?? []).includes(contentId)
    const alreadyDisliked = (userReact?.dislikedContent ?? []).includes(contentId)

    const contentInc = alreadyLiked
      ? { likeCount: -1 }
      : { likeCount: 1, ...(alreadyDisliked ? { dislikeCount: -1 } : {}) }

    // Cap likedContent at 2000 entries — prevents document bloat for power users.
    // $addToSet deduplicates; the $slice keeps only the 2000 most-recent.
    const userOp = alreadyLiked
      ? { $pull: { likedContent: contentId } }
      : {
          $addToSet: { likedContent: contentId },
          $pull:     { dislikedContent: contentId },
          $push:     { likedContent: { $each: [], $slice: -2000 } },
        }

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

    const userReact = await User.findById(userId).select('likedContent dislikedContent').lean()
    const alreadyLiked    = (userReact?.likedContent    ?? []).includes(contentId)
    const alreadyDisliked = (userReact?.dislikedContent ?? []).includes(contentId)

    const contentInc = alreadyDisliked
      ? { dislikeCount: -1 }
      : { dislikeCount: 1, ...(alreadyLiked ? { likeCount: -1 } : {}) }

    const userOp = alreadyDisliked
      ? { $pull: { dislikedContent: contentId } }
      : {
          $addToSet: { dislikedContent: contentId },
          $pull:     { likedContent: contentId },
          $push:     { dislikedContent: { $each: [], $slice: -2000 } },
        }

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

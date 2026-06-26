import { Router } from 'express'
import { createHash, randomUUID } from 'crypto'
import { createRequire } from 'module'
import { Types } from 'mongoose'
import rateLimit from 'express-rate-limit'
import { Content } from '../models/Content.js'
import { CuratedShelf } from '../models/CuratedShelf.js'
import { User } from '../models/User.js'
import { ViewEvent } from '../models/ViewEvent.js'
import { UserRating } from '../models/UserRating.js'
import { ActiveStream } from '../models/ActiveStream.js'
import { requireAuth, requireSubscription } from '../middleware/auth.js'
import { withCache } from '../config/cache.js'
import { getPlanLimits, getPlanTier } from '../config/planLimits.js'

const viewRateLimit = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             120,
  keyGenerator:    (req) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many view events. Please slow down.', code: 'RATE_LIMITED' },
})

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
  const pullZone = process.env.BUNNY_CDN_PULL_ZONE
  const path     = `/${videoId}/playlist.m3u8`
  const base     = `https://${pullZone}${path}`

  if (!sign) return base

  const key = process.env.BUNNY_CDN_TOKEN_AUTH_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      // Refuse to serve unsigned premium content — throw so the caller returns 503
      throw Object.assign(new Error('BUNNY_CDN_TOKEN_AUTH_KEY is not configured'), { status: 503 })
    }
    console.warn('[CDN] BUNNY_CDN_TOKEN_AUTH_KEY not set — serving premium content unsigned (dev only)')
    return base
  }

  const expires = Math.floor(Date.now() / 1000) + 3600  // 1-hour window
  const token = createHash('sha256')
    .update(key + path + expires)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return `${base}?token=${token}&expires=${expires}`
}

// Never send video GUIDs to public endpoints
const PUBLIC_FIELDS = '-bunnyVideoId -trailerVideoId -seasons.episodes.bunnyVideoId'

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
      isDeleted:        { $ne: true },
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
      sort === 'title'   ? { title: 1 } :
      sort === 'newest'  ? { releaseYear: -1, createdAt: -1 } :
      sort === 'popular' ? { viewCount: -1, communityRating: -1 } :
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
    const items = await Content.find(query).sort(sortObj).limit(200).select(PUBLIC_FIELDS).lean()
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

const RATING_MIN_WATCH_SECS = 300  // 5 minutes

/**
 * POST /api/content/:id/rate
 * Auth required. Body: { score: 1–5 }
 * Requires the user to have watched at least 5 minutes before rating.
 * Upserts the user's rating and recomputes the community average on Content.
 */
router.post('/:id/rate', requireAuth, async (req, res, next) => {
  try {
    const score = Number(req.body.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ error: 'Score must be an integer between 1 and 5' })
    }

    const contentId = req.params.id

    // Verify the user has watched enough before rating
    const userProgress = await User.findById(req.user._id).select('watchProgress').lean()
    const hasWatched = (userProgress?.watchProgress || []).some(
      (p) => String(p.contentId) === contentId && p.positionSecs >= RATING_MIN_WATCH_SECS
    )
    if (!hasWatched) {
      return res.status(403).json({
        error: 'Watch at least 5 minutes before rating.',
        code:  'INSUFFICIENT_WATCH_TIME',
      })
    }

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
    const items = await Content.find({
      isFeatured: true,
      isPublished: true,
      isDeleted: { $ne: true },
      submissionStatus: { $nin: ['pending', 'rejected'] },
    })
      .select(PUBLIC_FIELDS)
      .sort({ featuredOrder: 1, updatedAt: -1 })
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
    const item = await Content.findOne({ _id: req.params.id, isPublished: true, isDeleted: { $ne: true }, submissionStatus: { $nin: ['pending', 'rejected'] } }).select(PUBLIC_FIELDS).lean()
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
      .select('isPremium bunnyVideoId submissionStatus isPublished isDeleted creatorId seasons')
      .lean()

    if (!item) return res.status(404).json({ error: 'Content not found' })

    const isOwnContent = item?.creatorId && req.user?._id?.toString() === item.creatorId.toString()
    const isHidden = ['pending', 'rejected'].includes(item?.submissionStatus) || !item.isPublished || item.isDeleted
    if (isHidden && !isOwnContent) {
      return res.status(404).json({ error: 'Content not found' })
    }
    if (!req.user?.emailVerified) {
      return res.status(403).json({ error: 'Verified email required', code: 'EMAIL_VERIFICATION_REQUIRED' })
    }

    // For Series/Serial Drama, resolve the per-episode bunnyVideoId when ?season=S&episode=E supplied
    let videoId = item.bunnyVideoId
    const epNum  = req.query.episode != null ? Number(req.query.episode) : null
    const seNum  = req.query.season  != null ? Number(req.query.season)  : (epNum != null ? 1 : null)

    if (epNum != null && (!Number.isInteger(epNum) || epNum < 1)) {
      return res.status(400).json({ error: 'episode must be a positive integer' })
    }
    if (seNum != null && (!Number.isInteger(seNum) || seNum < 1)) {
      return res.status(400).json({ error: 'season must be a positive integer' })
    }

    if (epNum != null) {
      if (!item.seasons?.length) return res.status(404).json({ error: 'Season not found' })
      const season = item.seasons.find((s) => s.number === seNum)
      if (!season) return res.status(404).json({ error: 'Season not found' })
      const ep = season.episodes.find((e) => e.number === epNum)
      if (!ep) return res.status(404).json({ error: 'Episode not found' })
      if (!ep.bunnyVideoId) return res.status(404).json({ error: 'Episode video not yet available' })
      videoId = ep.bunnyVideoId
    }

    if (!videoId) return res.status(404).json({ error: 'No video attached to this title' })

    const limits = getPlanLimits(req.user)
    const tier   = getPlanTier(req.user)

    // Season 1 Episode 1 of any premium series is a free preview for non-subscribers
    const isFirstEpPreview = item.isPremium && seNum === 1 && epNum === 1 && (item.seasons?.length > 0) && !req.user.isSubscriptionActive

    if (item.isPremium && !isFirstEpPreview) {
      if (!req.user.isSubscriptionActive) {
        return res.status(403).json({ error: 'Active subscription required', code: 'SUBSCRIPTION_REQUIRED' })
      }

      // Count streams active in the last 90 s (2× heartbeat interval as tolerance)
      const activeCount = await ActiveStream.countDocuments({
        userId:          req.user._id,
        lastHeartbeatAt: { $gt: new Date(Date.now() - 90_000) },
      })

      if (activeCount >= limits.maxStreams) {
        const planName = req.user.subscriptionStatus === 'trial' ? 'trial' : (req.user.subscriptionPlan ?? 'current')
        return res.status(429).json({
          error:      `Your ${planName} plan allows ${limits.maxStreams} concurrent stream${limits.maxStreams > 1 ? 's' : ''}. Please stop another stream first, or upgrade your plan.`,
          code:       'TOO_MANY_STREAMS',
          maxStreams: limits.maxStreams,
        })
      }

      const sessionId = randomUUID()
      await ActiveStream.create({ userId: req.user._id, sessionId, contentId: item._id.toString() })

      return res.json({
        hlsUrl:           buildHlsUrl(videoId, true),
        sessionId,
        maxQualityHeight: limits.maxQualityHeight,
        tier,
      })
    }

    // Free content or first-episode preview — unsigned URL, quality capped by user tier
    // (preview always caps at 480p regardless of account status)
    res.json({
      hlsUrl:           buildHlsUrl(videoId, false),
      maxQualityHeight: isFirstEpPreview ? 480 : limits.maxQualityHeight,
      tier:             isFirstEpPreview ? 'free' : tier,
      ...(isFirstEpPreview && { isFirstEpPreview: true }),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/content/heartbeat
 * Called every 30 s by the player to keep the stream session alive.
 */
router.post('/heartbeat', requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.body
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
    await ActiveStream.findOneAndUpdate(
      { sessionId, userId: req.user._id },
      { $set: { lastHeartbeatAt: new Date() } }
    )
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/content/stream-session/:sessionId
 * Called when the player unmounts so the slot is freed immediately.
 */
router.delete('/stream-session/:sessionId', requireAuth, async (req, res, next) => {
  try {
    await ActiveStream.deleteOne({ sessionId: req.params.sessionId, userId: req.user._id })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

const VIEW_MIN_POSITION_SECS = 30   // client must have watched at least 30 s
const VIEW_DEDUP_WINDOW_MS   = 24 * 60 * 60 * 1000  // one counted view per user per content per day

/**
 * POST /api/content/:id/view
 * Auth required. Records a view when the user has genuinely watched content:
 *   - content must be published and not deleted
 *   - premium content requires an active subscription
 *   - client must send positionSecs >= 30 (confirmed playback threshold)
 *   - deduplicated per user+content+episode within a 24-hour window
 *
 * Returns { ok: true, counted: boolean } — counted=false means the view was
 * a duplicate and was not written; the client should treat both as success.
 */
router.post('/:id/view', requireAuth, viewRateLimit, async (req, res, next) => {
  try {
    const id             = req.params.id
    const seasonNumber   = req.body.seasonNumber  != null ? Number(req.body.seasonNumber)  : null
    const episodeNumber  = req.body.episodeNumber != null ? Number(req.body.episodeNumber) : null
    const positionSecs   = Number(req.body.positionSecs ?? 0)

    if (!req.user?.emailVerified) {
      return res.status(403).json({ error: 'Verified email required', code: 'EMAIL_VERIFICATION_REQUIRED' })
    }

    // Require proof of real playback before counting
    if (positionSecs < VIEW_MIN_POSITION_SECS) {
      return res.status(400).json({
        error: `positionSecs must be at least ${VIEW_MIN_POSITION_SECS}`,
        code:  'INSUFFICIENT_PLAYBACK',
      })
    }
    if (episodeNumber != null && !Number.isInteger(episodeNumber)) {
      return res.status(400).json({ error: 'episodeNumber must be an integer' })
    }

    // Validate the content exists, is published, and is not deleted
    const item = await Content.findOne({
      _id:              id,
      isPublished:      true,
      isDeleted:        { $ne: true },
      submissionStatus: { $nin: ['pending', 'rejected'] },
    }).select('isPremium creatorId seasons').lean()

    if (!item) return res.status(404).json({ error: 'Content not found' })

    // Entitlement check for premium content
    // Creators can view their own content without a subscription
    const isOwnContent = item.creatorId && req.user._id.toString() === item.creatorId.toString()
    if (item.isPremium && !isOwnContent && !req.user.isSubscriptionActive) {
      return res.status(403).json({ error: 'Active subscription required', code: 'SUBSCRIPTION_REQUIRED' })
    }

    // 24-hour deduplication — one view per user per content per season+episode per day
    const dedupSince = new Date(Date.now() - VIEW_DEDUP_WINDOW_MS)
    const recentView = await ViewEvent.exists({
      userId:        req.user._id,
      contentId:     id,
      seasonNumber:  seasonNumber  ?? null,
      episodeNumber: episodeNumber ?? null,
      viewedAt:      { $gte: dedupSince },
    })

    if (recentView) {
      return res.json({ ok: true, counted: false })
    }

    // Increment view count atomically
    let doc
    if (episodeNumber != null && seasonNumber != null) {
      const season = (item.seasons || []).find((s) => s.number === seasonNumber)
      if (!season || !season.episodes.some((ep) => ep.number === episodeNumber)) {
        return res.status(404).json({ error: 'Episode not found' })
      }
      doc = await Content.findByIdAndUpdate(
        id,
        { $inc: { viewCount: 1, 'seasons.$[s].episodes.$[ep].viewCount': 1 } },
        { arrayFilters: [{ 's.number': seasonNumber }, { 'ep.number': episodeNumber }], select: 'creatorId' }
      )
    } else {
      doc = await Content.findByIdAndUpdate(id, { $inc: { viewCount: 1 } }, { select: 'creatorId' })
    }

    res.json({ ok: true, counted: true })

    // Fire-and-forget: write ViewEvent for deduplication and creator analytics.
    const now    = new Date()
    const rawIp  = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || ''
    const geo    = geoip.lookup(rawIp) || {}
    const ua     = req.headers['user-agent'] || ''
    const device = /smart-tv|webos|tizen|roku|firetv|tv/i.test(ua) ? 'tv'
      : /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop'
    const state  = geo.country === 'IN' && geo.region
      ? (IN_STATES[geo.region] || geo.region)
      : (geo.country || 'Unknown')

    ViewEvent.create({
      contentId:     id,
      seasonNumber:  seasonNumber  ?? null,
      episodeNumber: episodeNumber ?? null,
      creatorId:     doc?.creatorId ?? null,
      userId:        req.user._id,
      viewedAt:      now,
      hour:          now.getHours(),
      dayOfWeek:     now.getDay(),
      state,
      city:          geo.city    || 'Unknown',
      country:       geo.country || 'Unknown',
      device,
    }).catch((err) => console.error('[view-event] write failed:', err.message))
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

    // Atomic toggle — the query filter (already-liked or not) guarantees only
    // one of two concurrent requests can match, so we know for certain which
    // direction *this* request moved the user's state in and can increment
    // Content's counters without a read-then-increment race.
    const contentInc = {}
    let liked

    const added = await User.findOneAndUpdate(
      { _id: userId, likedContent: { $ne: contentId } },
      { $addToSet: { likedContent: contentId }, $pull: { dislikedContent: contentId } },
      { new: false }
    ).select('dislikedContent').lean()

    if (added) {
      liked = true
      contentInc.likeCount = 1
      if ((added.dislikedContent ?? []).includes(contentId)) contentInc.dislikeCount = -1
    } else {
      const removed = await User.findOneAndUpdate(
        { _id: userId, likedContent: contentId },
        { $pull: { likedContent: contentId } },
        { new: false }
      ).select('_id').lean()
      liked = false
      if (removed) contentInc.likeCount = -1
    }

    const [content, user] = await Promise.all([
      Object.keys(contentInc).length
        ? Content.findByIdAndUpdate(contentId, { $inc: contentInc }, { new: true }).select('likeCount dislikeCount').lean()
        : Content.findById(contentId).select('likeCount dislikeCount').lean(),
      User.findById(userId).select('likedContent dislikedContent').lean(),
    ])

    if (!content) return res.status(404).json({ error: 'Content not found' })

    // Trim likedContent cap in a separate fire-and-forget step
    if (liked) {
      User.findByIdAndUpdate(userId, { $push: { likedContent: { $each: [], $slice: -2000 } } }).catch(() => {})
    }

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

    // Atomic toggle — see /like above for why the read-then-increment pattern is unsafe.
    const contentInc = {}
    let disliked

    const added = await User.findOneAndUpdate(
      { _id: userId, dislikedContent: { $ne: contentId } },
      { $addToSet: { dislikedContent: contentId }, $pull: { likedContent: contentId } },
      { new: false }
    ).select('likedContent').lean()

    if (added) {
      disliked = true
      contentInc.dislikeCount = 1
      if ((added.likedContent ?? []).includes(contentId)) contentInc.likeCount = -1
    } else {
      const removed = await User.findOneAndUpdate(
        { _id: userId, dislikedContent: contentId },
        { $pull: { dislikedContent: contentId } },
        { new: false }
      ).select('_id').lean()
      disliked = false
      if (removed) contentInc.dislikeCount = -1
    }

    const [content, user] = await Promise.all([
      Object.keys(contentInc).length
        ? Content.findByIdAndUpdate(contentId, { $inc: contentInc }, { new: true }).select('likeCount dislikeCount').lean()
        : Content.findById(contentId).select('likeCount dislikeCount').lean(),
      User.findById(userId).select('likedContent dislikedContent').lean(),
    ])

    if (!content) return res.status(404).json({ error: 'Content not found' })

    if (disliked) {
      User.findByIdAndUpdate(userId, { $push: { dislikedContent: { $each: [], $slice: -2000 } } }).catch(() => {})
    }

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

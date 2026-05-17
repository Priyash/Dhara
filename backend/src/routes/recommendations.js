import { Router } from 'express'
import { Types } from 'mongoose'
import { admin } from '../config/firebase.js'
import { User } from '../models/User.js'
import { Content } from '../models/Content.js'
import { InteractionEvent, INTERACTION_EVENT_TYPES } from '../models/InteractionEvent.js'

const router = Router()

const PUBLIC_FIELDS = '-bunnyVideoId -trailerVideoId -episodes.bunnyVideoId'

const EVENT_WEIGHTS = {
  impression: 0.2,
  play:       2,
  view_3s:    2.5,
  view_50:    5,
  completion: 8,
  like:       7,
  share:      6,
  skip:      -4,
}

async function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return next()

  try {
    const decoded = await admin.auth().verifyIdToken(token, true)
    req.firebaseUser = decoded
    req.user = await User.findOne({ firebaseUid: decoded.uid })
      .select('_id firebaseUid email emailVerified subscriptionStatus subscriptionExpiresAt trialEndsAt graceEndsAt')
  } catch {
    // Tracking should still work for anonymous sessions if the token is stale.
  }
  next()
}

function publicContentFilter(extra = {}) {
  return {
    isPublished: true,
    isDeleted: { $ne: true },
    submissionStatus: { $nin: ['pending', 'rejected'] },
    ...extra,
  }
}

function parseObjectId(id) {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null
}

// Events that get server-side dedup — prevents page-reload replay noise from
// inflating high-weight signals in the recommendation engine.
//
// DAILY_DEDUP: one event per user/session per item per UTC calendar day.
//   play (2), view_3s (2.5), view_50 (5), completion (8), share (6), skip (-4)
//
// LIFETIME_DEDUP: one event per user/session per item, ever.
//   like (7) — the toggle already prevents duplicate API calls, but a session
//   reload could re-fire this from milestoneRef reset.
//
// NO DEDUP: impression (0.2) — multiple impressions from different days/sessions
//   are valid signals for ranking; deduping them would under-represent popular items.
const DAILY_DEDUP_EVENTS    = new Set(['play', 'view_3s', 'view_50', 'completion', 'share', 'skip'])
const LIFETIME_DEDUP_EVENTS = new Set(['like'])

function utcDay() {
  return new Date().toISOString().slice(0, 10)  // 'YYYY-MM-DD'
}

function computeDedupKey(eventType, itemId, userId, sessionId) {
  // No identity means we can't deduplicate — write freely
  const identity = userId ? `u:${userId}` : (sessionId ? `s:${sessionId}` : '')
  if (!identity) return ''

  if (LIFETIME_DEDUP_EVENTS.has(eventType)) return `${identity}:${itemId}:${eventType}`
  if (DAILY_DEDUP_EVENTS.has(eventType))    return `${identity}:${itemId}:${eventType}:${utcDay()}`
  return ''  // impression and anything else — no dedup
}

function normalizeEventPayload(body = {}) {
  const itemType = body.itemType === 'reel' ? 'reel' : 'content'
  const eventType = String(body.eventType || '').trim()
  const itemId = parseObjectId(body.itemId)

  return {
    itemType,
    itemId,
    eventType,
    sessionId: String(body.sessionId || '').slice(0, 120),
    episodeNumber: body.episodeNumber != null ? Number(body.episodeNumber) : null,
    source: String(body.source || '').slice(0, 80),
    positionSecs: Math.max(0, Number(body.positionSecs) || 0),
    durationSecs: Math.max(0, Number(body.durationSecs) || 0),
    percent: Math.min(1, Math.max(0, Number(body.percent) || 0)),
  }
}

router.post('/events', optionalAuth, async (req, res, next) => {
  try {
    const payload = normalizeEventPayload(req.body)
    if (!payload.itemId) return res.status(400).json({ error: 'Valid itemId is required' })
    if (!INTERACTION_EVENT_TYPES.includes(payload.eventType)) {
      return res.status(400).json({ error: 'Invalid eventType' })
    }

    const userId   = req.user?._id ?? null
    const dedupKey = computeDedupKey(payload.eventType, payload.itemId, userId, payload.sessionId)
    const doc      = { userId, ...payload, dedupKey }

    if (dedupKey) {
      // Atomic upsert: insert on first occurrence, no-op on duplicate.
      // The sparse unique index on dedupKey ensures races are safe —
      // a concurrent duplicate write gets E11000 and is caught below.
      try {
        await InteractionEvent.updateOne(
          { dedupKey },
          { $setOnInsert: doc },
          { upsert: true }
        )
      } catch (err) {
        if (err.code !== 11000) throw err
        // E11000 = duplicate key — event already exists for this key, silently ignore
      }
    } else {
      await InteractionEvent.create(doc)
    }

    res.status(202).json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 12)))
    const excludeIds = String(req.query.exclude || '')
      .split(',')
      .map((id) => parseObjectId(id.trim()))
      .filter(Boolean)

    const identity = req.user?._id
      ? { userId: req.user._id }
      : req.query.sessionId
      ? { sessionId: String(req.query.sessionId).slice(0, 120) }
      : null

    const recentEvents = identity
      ? await InteractionEvent.find({ ...identity, itemType: 'content' })
          .sort({ createdAt: -1 })
          .limit(200)
          .lean()
      : []

    const interactedIds = [...new Set(recentEvents.map((e) => String(e.itemId)))]
      .map((id) => parseObjectId(id))
      .filter(Boolean)

    const watched = interactedIds.length
      ? await Content.find({ _id: { $in: interactedIds } })
          .select('type genre')
          .lean()
      : []

    const typeWeights = new Map()
    const genreWeights = new Map()
    const watchedMap = new Map(watched.map((item) => [String(item._id), item]))

    for (const event of recentEvents) {
      const weight = EVENT_WEIGHTS[event.eventType] ?? 0
      if (weight === 0) continue
      const item = watchedMap.get(String(event.itemId))
      if (!item) continue

      if (item.type) typeWeights.set(item.type, (typeWeights.get(item.type) || 0) + weight)
      for (const genre of item.genre || []) {
        genreWeights.set(genre, (genreWeights.get(genre) || 0) + weight)
      }
    }

    const candidateFilter = publicContentFilter({
      _id: { $nin: [...excludeIds, ...interactedIds].filter(Boolean) },
    })

    // Pull a broad cross-section: half by rating (quality signal), half by recency.
    // This prevents the pool from being dominated by the 250 most-recently-edited items.
    const [byRating, byRecency] = await Promise.all([
      Content.find(candidateFilter).sort({ rating: -1, communityRating: -1 }).limit(150).select(PUBLIC_FIELDS).lean(),
      Content.find(candidateFilter).sort({ createdAt: -1 }).limit(150).select(PUBLIC_FIELDS).lean(),
    ])
    // Merge and deduplicate
    const seen = new Set()
    const candidates = []
    for (const item of [...byRating, ...byRecency]) {
      const id = String(item._id)
      if (!seen.has(id)) { seen.add(id); candidates.push(item) }
    }

    // Normalise popularity to [0, POP_CAP] so a viral film doesn't drown affinity signals.
    // log1p(1M views) ≈ 13.8 → with cap 8 this is clamped, preserving the signal direction
    // while giving type/genre affinity (~3–15) room to influence the ranking.
    const POP_CAP      = 8
    const FRESH_DAYS   = 30
    const freshCutoff  = Date.now() - FRESH_DAYS * 86_400_000

    // Determine if any affinity signal exists so we can label the strategy honestly
    const hasAffinity  = typeWeights.size > 0 || genreWeights.size > 0

    const scored = candidates
      .map((item) => {
        // Fix 2: prefer communityRating when non-zero, fall back to editorial rating
        const ratingVal   = (item.communityRating > 0 ? item.communityRating : item.rating) || 0
        const quality     = ratingVal * 1.5   // 0 – 7.5

        // Fix 3: cap popularity so viral content doesn't dominate affinity signals
        const rawPop      = Math.log1p(item.viewCount || 0) + Math.log1p(item.likeCount || 0) * 1.2
        const popularity  = Math.min(rawPop, POP_CAP)   // 0 – 8

        const typeScore   = typeWeights.get(item.type) || 0
        const genreScore  = (item.genre || []).reduce((s, g) => s + (genreWeights.get(g) || 0), 0)

        // Fix 4: freshness — badge:NEW gets 3, content < 30 days old gets 1.5, else 0
        const ageFresh    = new Date(item.createdAt).getTime() >= freshCutoff ? 1.5 : 0
        const fresh       = item.badge === 'NEW' ? 3 : ageFresh

        return { item, score: quality + popularity + typeScore + genreScore + fresh }
      })
      .sort((a, b) => b.score - a.score)

    // Fix 5: diversity — cap at 4 items per content type to avoid mono-type results
    const TYPE_CAP    = 4
    const typeCounts  = new Map()
    const diverse     = []
    for (const entry of scored) {
      const t = entry.item.type
      if ((typeCounts.get(t) || 0) >= TYPE_CAP) continue
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1)
      diverse.push(entry.item)   // Fix 7: drop _recommendationScore from response
      if (diverse.length >= limit) break
    }

    // Determine strategy label honestly: personalized only when affinity signals exist
    const strategy = hasAffinity ? 'personalized' : (identity ? 'session' : 'popular')

    if (diverse.length > 0) return res.json({ items: diverse, strategy })

    const fallback = await Content.find(publicContentFilter({ _id: { $nin: excludeIds } }))
      .sort({ rating: -1, viewCount: -1, updatedAt: -1 })
      .limit(limit)
      .select(PUBLIC_FIELDS)
      .lean()

    res.json({ items: fallback, strategy: 'fallback' })
  } catch (err) {
    next(err)
  }
})

export default router

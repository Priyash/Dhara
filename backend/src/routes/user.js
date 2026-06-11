import { Router } from 'express'
import { User } from '../models/User.js'
import { Content } from '../models/Content.js'
import { requireAuth } from '../middleware/auth.js'
import { serializeUser } from './auth.js'

const PUBLIC_FIELDS = '-bunnyVideoId -trailerVideoId -episodes.bunnyVideoId'

const router = Router()

// All user routes require authentication
router.use(requireAuth)

/**
 * GET /api/user/me
 * Returns the current user's profile and subscription status.
 */
router.get('/me', async (req, res, next) => {
  try {
    const firebaseUser = req.firebaseUser || {}
    const tokenAuthTime = firebaseUser.auth_time ? new Date(firebaseUser.auth_time * 1000) : null
    const tokenEmailVerified = typeof firebaseUser.email_verified === 'boolean'
      ? firebaseUser.email_verified
      : null

    const updates = {}
    if (tokenEmailVerified !== null && req.user.emailVerified !== tokenEmailVerified) {
      updates.emailVerified = tokenEmailVerified
    }
    // Update lastLoginAt to now, but at most once per hour to avoid a DB write on every page load.
    // This ensures DAU counts any user who was active today, not just those who signed in today.
    const ONE_HOUR_MS = 60 * 60 * 1000
    const lastSeen = req.user.lastLoginAt ? new Date(req.user.lastLoginAt).getTime() : 0
    if (Date.now() - lastSeen > ONE_HOUR_MS) {
      updates.lastLoginAt = new Date()
    }

    // Always load the full document for /me — it includes watchlist, likedContent,
    // dislikedContent which are excluded from req.user for performance on every other route.
    const u = Object.keys(updates).length > 0
      ? await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true })
      : await User.findById(req.user._id)

    if (!u) return res.status(404).json({ error: 'User not found' })

    res.json(serializeUser(u))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/user/watchlist/:id
 * Adds a content ID to the user's watchlist (idempotent).
 */
router.post('/watchlist/:id', async (req, res, next) => {
  try {
    const contentId = req.params.id
    // Two-step: addToSet prevents duplicates, then slice caps the array at 500.
    // Without the cap, a power user could accumulate thousands of IDs and bloat
    // their document beyond practical query limits.
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { watchlist: contentId } })
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $push: { watchlist: { $each: [], $slice: -500 } } },
      { new: true, select: 'watchlist' }
    )
    res.json({ watchlist: user.watchlist })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/user/watchlist/:id
 * Removes a content ID from the user's watchlist.
 */
router.delete('/watchlist/:id', async (req, res, next) => {
  try {
    const contentId = req.params.id
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { watchlist: contentId } },
      { new: true }
    )
    res.json({ watchlist: user.watchlist })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/user/watchlist-items
 * Returns full content objects for the user's watchlist (no more client-side filter of all content).
 */
router.get('/watchlist-items', async (req, res, next) => {
  try {
    const u   = await User.findById(req.user._id).select('watchlist').lean()
    const ids = u?.watchlist || []
    if (ids.length === 0) return res.json([])
    const items = await Content.find({
      _id: { $in: ids },
      isPublished: true,
    }).select(PUBLIC_FIELDS).lean()
    // Preserve watchlist order
    const map = new Map(items.map((i) => [String(i._id), i]))
    const ordered = ids.map((id) => map.get(id)).filter(Boolean)
    res.json(ordered)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/user/watch-progress
 * Upserts watch progress for a content item. Called periodically by the player.
 */
router.post('/watch-progress', async (req, res, next) => {
  try {
    const { contentId, episodeNumber = null, positionSecs, durationSecs } = req.body
    if (!contentId || positionSecs == null) {
      return res.status(400).json({ error: 'contentId and positionSecs are required' })
    }

    const pos = Number(positionSecs)
    const dur = Number(durationSecs) || 0
    const now = new Date()

    // Try to update the existing entry in-place first (single atomic op, no race condition).
    // Fall back to push only when no entry exists yet.
    const updated = await User.findOneAndUpdate(
      { _id: req.user._id, 'watchProgress.contentId': contentId, 'watchProgress.episodeNumber': episodeNumber ?? null },
      { $set: { 'watchProgress.$.positionSecs': pos, 'watchProgress.$.durationSecs': dur, 'watchProgress.$.updatedAt': now } },
      { new: false, select: '_id' }
    )

    if (!updated) {
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          watchProgress: {
            $each: [{ contentId, episodeNumber: episodeNumber ?? null, positionSecs: pos, durationSecs: dur, updatedAt: now }],
            $position: 0,
            $slice: 30,
          },
        },
      })
    }

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/user/watch-progress
 * Clears all watch progress entries for the current user.
 */
router.delete('/watch-progress', async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $set: { watchProgress: [] } })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/user/watch-progress/:contentId
 * Removes the watch progress entry for a specific content item (all episodes).
 */
router.delete('/watch-progress/:contentId', async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { watchProgress: { contentId: req.params.contentId } },
    })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/user/profile
 * Update mutable user profile fields: displayName, photoURL.
 */
router.patch('/profile', async (req, res, next) => {
  try {
    const ALLOWED = ['displayName', 'photoURL']
    const updates = {}
    for (const key of ALLOWED) {
      if (key in req.body) updates[key] = String(req.body[key] || '').trim()
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' })
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true })
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ displayName: user.displayName, photoURL: user.photoURL })
  } catch (err) {
    next(err)
  }
})

const CONTINUE_WATCHING_MAX_AGE_DAYS = 90

/**
 * GET /api/user/continue-watching
 * Returns up to 8 in-progress content items, sorted by most recent activity.
 * Entries older than 90 days are automatically excluded.
 */
router.get('/continue-watching', async (req, res, next) => {
  try {
    const cutoff   = new Date(Date.now() - CONTINUE_WATCHING_MAX_AGE_DAYS * 86_400_000)
    const u        = await User.findById(req.user._id).select('watchProgress').lean()
    const progress = (u?.watchProgress || [])
      .filter((p) =>
        p.positionSecs > 30 &&
        (p.durationSecs === 0 || p.positionSecs < p.durationSecs - 30) &&
        (!p.updatedAt || new Date(p.updatedAt) >= cutoff)
      )
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, 8)

    if (progress.length === 0) return res.json([])

    const ids = progress.map((p) => p.contentId)
    const items = await Content.find({
      _id: { $in: ids },
      isPublished: true,
    }).select(PUBLIC_FIELDS).lean()

    const itemMap = new Map(items.map((i) => [String(i._id), i]))

    const result = progress
      .map((p) => {
        const item = itemMap.get(p.contentId)
        if (!item) return null
        return { ...item, _progress: { positionSecs: p.positionSecs, durationSecs: p.durationSecs, episodeNumber: p.episodeNumber } }
      })
      .filter(Boolean)

    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router

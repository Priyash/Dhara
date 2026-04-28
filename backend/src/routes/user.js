import { Router } from 'express'
import { User } from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { serializeUser } from './auth.js'

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
    if (tokenAuthTime && (!req.user.lastLoginAt || tokenAuthTime > req.user.lastLoginAt)) {
      updates.lastLoginAt = tokenAuthTime
    }

    const u = Object.keys(updates).length > 0
      ? await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true })
      : req.user

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
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { watchlist: contentId } },
      { new: true }
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

export default router

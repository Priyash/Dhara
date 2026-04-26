import { Router } from 'express'
import { User } from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// All user routes require authentication
router.use(requireAuth)

/**
 * GET /api/user/me
 * Returns the current user's profile and subscription status.
 */
router.get('/me', (req, res) => {
  const u = req.user
  if (!u) return res.status(404).json({ error: 'User not found' })
  res.json({
    id:                    u._id,
    firebaseUid:           u.firebaseUid,
    email:                 u.email,
    displayName:           u.displayName,
    photoURL:              u.photoURL,
    isSubscribed:          u.isSubscriptionActive,
    subscriptionPlan:      u.subscriptionPlan,
    subscriptionExpiresAt: u.subscriptionExpiresAt,
    watchlist:             u.watchlist,
    createdAt:             u.createdAt,
    updatedAt:             u.updatedAt,
  })
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

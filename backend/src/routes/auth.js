import { Router } from 'express'
import { admin } from '../config/firebase.js'
import { User } from '../models/User.js'

const router = Router()

const TRIAL_DAYS = 7

function serializeUser(u, { isAdmin = false } = {}) {
  return {
    id:                    u._id,
    firebaseUid:           u.firebaseUid,
    email:                 u.email,
    emailVerified:         u.emailVerified,
    displayName:           u.displayName,
    photoURL:              u.photoURL,
    lastLoginAt:           u.lastLoginAt,
    isAdmin,
    isSubscribed:          u.isSubscriptionActive,
    subscriptionStatus:    u.subscriptionStatus,
    subscriptionPlan:      u.subscriptionPlan,
    subscriptionExpiresAt: u.subscriptionExpiresAt,
    trialEndsAt:           u.trialEndsAt,
    graceEndsAt:           u.graceEndsAt,
    watchlist:             u.watchlist,
    likedContent:          u.likedContent    ?? [],
    dislikedContent:       u.dislikedContent ?? [],
    // Creator Studio
    isCreator:              Boolean(u.isCreator),
    creatorStatus:          u.creatorStatus          ?? 'none',
    creatorProfile:         u.creatorProfile         ?? null,
    creatorRejectionReason: u.creatorRejectionReason ?? '',
    creatorRejectedAt:      u.creatorRejectedAt      ?? null,
    creatorReapplyAfter:    u.creatorReapplyAfter     ?? null,
    creatorRejectionCount:  u.creatorRejectionCount  ?? 0,
    createdAt:              u.createdAt,
    updatedAt:              u.updatedAt,
  }
}

/**
 * POST /api/auth/login
 * Body: { idToken: string } — Firebase ID token from the client.
 * Verifies the token, upserts the user in MongoDB, and starts a free trial
 * for brand-new accounts.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { idToken } = req.body
    if (!idToken) return res.status(400).json({ error: 'idToken is required' })

    const decoded = await admin.auth().verifyIdToken(idToken)

    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    const isAdmin = decoded.admin === true || adminEmails.includes((decoded.email || '').toLowerCase())

    const userAlreadyExists = await User.exists({ firebaseUid: decoded.uid })
    const tokenAuthTime = decoded.auth_time ? new Date(decoded.auth_time * 1000) : null

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000)

    const user = await User.findOneAndUpdate(
      { firebaseUid: decoded.uid },
      {
        $set: {
          email:         decoded.email || '',
          emailVerified: Boolean(decoded.email_verified),
          displayName:   decoded.name  || decoded.email?.split('@')[0] || '',
          photoURL:      decoded.picture || '',
          lastLoginAt: new Date(),   // always current time — auth_time is when Firebase issued the token, not when the user is active now
        },
        $setOnInsert: {
          firebaseUid:        decoded.uid,
          subscriptionStatus: 'trial',
          trialEndsAt,
        },
      },
      { upsert: true, new: true }
    )

    res.json({
      user:           serializeUser(user, { isAdmin }),
      profileCreated: !userAlreadyExists,
    })
  } catch (err) {
    next(err)
  }
})

export { serializeUser }
export default router

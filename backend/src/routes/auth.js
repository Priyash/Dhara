import { Router } from 'express'
import { admin } from '../config/firebase.js'
import { User } from '../models/User.js'

const router = Router()

/**
 * POST /api/auth/login
 * Body: { idToken: string }  — Firebase ID token from the client
 * Verifies the token, then upserts the user in MongoDB.
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

    const user = await User.findOneAndUpdate(
      { firebaseUid: decoded.uid },
      {
        $set: {
          email:         decoded.email || '',
          emailVerified: Boolean(decoded.email_verified),
          displayName:   decoded.name  || decoded.email?.split('@')[0] || '',
          photoURL:      decoded.picture || '',
          ...(tokenAuthTime ? { lastLoginAt: tokenAuthTime } : {}),
        },
        $setOnInsert: { firebaseUid: decoded.uid },
      },
      { upsert: true, new: true }
    )

    res.json({
      user: {
        id:           user._id,
        firebaseUid:  user.firebaseUid,
        email:        user.email,
        emailVerified: user.emailVerified,
        displayName:  user.displayName,
        photoURL:     user.photoURL,
        lastLoginAt:  user.lastLoginAt,
        isAdmin:      isAdmin,
        isSubscribed: user.isSubscriptionActive,
        subscriptionPlan: user.subscriptionPlan,
        watchlist:    user.watchlist,
        createdAt:    user.createdAt,
        updatedAt:    user.updatedAt,
      },
      profileCreated: !userAlreadyExists,
    })
  } catch (err) {
    next(err)
  }
})

export default router

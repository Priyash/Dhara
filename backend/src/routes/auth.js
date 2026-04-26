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
    const userAlreadyExists = await User.exists({ firebaseUid: decoded.uid })

    const user = await User.findOneAndUpdate(
      { firebaseUid: decoded.uid },
      {
        $set: {
          email:       decoded.email || '',
          displayName: decoded.name  || decoded.email?.split('@')[0] || '',
          photoURL:    decoded.picture || '',
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
        displayName:  user.displayName,
        photoURL:     user.photoURL,
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

import { admin } from '../config/firebase.js'
import { User } from '../models/User.js'

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing auth token' })

  try {
    const decoded = await admin.auth().verifyIdToken(token)
    // Attach both the decoded Firebase token and the MongoDB user
    req.firebaseUser = decoded
    let user = await User.findOne({ firebaseUid: decoded.uid })

    // Safety net: if auth succeeds but profile does not exist yet, create it.
    if (!user) {
      user = await User.findOneAndUpdate(
        { firebaseUid: decoded.uid },
        {
          $set: {
            email: decoded.email || '',
            displayName: decoded.name || decoded.email?.split('@')[0] || '',
            photoURL: decoded.picture || '',
          },
          $setOnInsert: { firebaseUid: decoded.uid },
        },
        { upsert: true, new: true }
      )
    }

    req.user = user
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export async function requireSubscription(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' })
  if (!req.user.isSubscriptionActive) {
    return res.status(403).json({ error: 'Active subscription required' })
  }
  next()
}

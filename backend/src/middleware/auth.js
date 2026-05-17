import { admin } from '../config/firebase.js'
import { User } from '../models/User.js'

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing auth token' })

  try {
    // checkRevoked=true ensures password changes/revocations invalidate sessions quickly
    const decoded = await admin.auth().verifyIdToken(token, true)
    const tokenAuthTime = decoded.auth_time ? new Date(decoded.auth_time * 1000) : null
    // Attach both the decoded Firebase token and the MongoDB user
    req.firebaseUser = decoded

    // Only load the fields needed for auth/subscription/creator checks.
    // watchlist, likedContent, dislikedContent, watchProgress are large arrays
    // that grow per user — loading them on every request wastes DB bandwidth.
    // Routes that need those arrays (watchlist-items, continue-watching, like/dislike,
    // /me) perform their own targeted queries.
    const AUTH_SELECT = [
      '_id firebaseUid email emailVerified displayName photoURL lastLoginAt',
      'subscriptionStatus subscriptionPlan subscriptionExpiresAt trialEndsAt graceEndsAt',
      'isCreator creatorStatus creatorProfile creatorRejectionReason creatorRejectedAt',
      'creatorRejectionCount creatorReapplyAfter creatorTier',
    ].join(' ')

    let user = await User.findOne({ firebaseUid: decoded.uid }).select(AUTH_SELECT)

    // Safety net: if auth succeeds but profile does not exist yet, create it.
    if (!user) {
      user = await User.findOneAndUpdate(
        { firebaseUid: decoded.uid },
        {
          $set: {
            email:         decoded.email || '',
            emailVerified: Boolean(decoded.email_verified),
            displayName:   decoded.name || decoded.email?.split('@')[0] || '',
            photoURL:      decoded.picture || '',
            ...(tokenAuthTime ? { lastLoginAt: tokenAuthTime } : {}),
          },
          $setOnInsert: { firebaseUid: decoded.uid },
        },
        { upsert: true, new: true, select: AUTH_SELECT }
      )
    }

    req.user = user
    next()
  } catch (err) {
    if (err?.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'Session revoked. Please sign in again.' })
    }
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

export function requireCreator(req, res, next) {
  if (!req.user?.isCreator || req.user?.creatorStatus !== 'approved') {
    return res.status(403).json({ error: 'Creator access required' })
  }
  next()
}

export function requireAdmin(req, res, next) {
  const allowlist = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  const email = (req.user?.email || '').toLowerCase()
  if (!email) return res.status(403).json({ error: 'Admin access required' })

  const isAllowlisted = allowlist.includes(email)
  const hasAdminClaim = req.firebaseUser?.admin === true

  if (!isAllowlisted && !hasAdminClaim) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  next()
}

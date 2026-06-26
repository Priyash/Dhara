import { Router } from 'express'
import { admin } from '../config/firebase.js'
import { User } from '../models/User.js'
import { CurrencyConfig } from '../models/CurrencyConfig.js'
import { countryForRequest } from '../utils/geo.js'
import { currencyForCountry } from '../utils/countryCurrency.js'

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

/**
 * GET /api/auth/locale
 * Public, unauthenticated. Detects the caller's country from their IP and
 * returns an approximate local-currency hint for subscription pricing.
 * Billing itself always stays in INR — this is display-only, so `currency`
 * is null whenever the country is India, unmapped, or has no admin-set rate.
 */
router.get('/locale', async (req, res, next) => {
  try {
    const countryCode = countryForRequest(req)

    if (!countryCode || countryCode === 'IN') {
      return res.json({ countryCode: countryCode || null, currency: null })
    }

    const mapped = currencyForCountry(countryCode)
    if (!mapped) return res.json({ countryCode, currency: null })

    const config  = await CurrencyConfig.getConfig()
    const rateMap = CurrencyConfig.toRateMap(config)
    const rate     = rateMap.get(mapped.currencyCode)

    if (!rate) return res.json({ countryCode, currency: null })

    res.json({
      countryCode,
      currency: {
        currencyCode: mapped.currencyCode,
        symbol:       rate.symbol || mapped.symbol,
        rateFromInr:  rate.rateFromInr,
      },
    })
  } catch (err) {
    next(err)
  }
})

export { serializeUser }
export default router

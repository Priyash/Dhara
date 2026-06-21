// env.js must be the very first import — it populates process.env before anything reads it
import './src/config/env.js'
import express from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { randomUUID } from 'crypto'
import mongoose from 'mongoose'

import './src/config/firebase.js'
import { connectMongoDB, dbStatus } from './src/config/mongodb.js'
import { syncAdminClaims } from './src/config/adminSync.js'
import { startSubscriptionExpiryJob } from './src/config/subscriptionExpiry.js'
import { startEarningsJob } from './src/config/earningsJob.js'

import authRoutes           from './src/routes/auth.js'
import contentRoutes        from './src/routes/content.js'
import userRoutes           from './src/routes/user.js'
import paymentRoutes        from './src/routes/payments.js'
import searchRoutes         from './src/routes/search.js'
import adminRoutes          from './src/routes/admin.js'
import creatorRoutes        from './src/routes/creator.js'
import reelRoutes           from './src/routes/reels.js'
import recommendationRoutes from './src/routes/recommendations.js'
import { errorHandler } from './src/middleware/errorHandler.js'

// ── Startup env validation ────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  const required = [
    'MONGODB_URI', 'FIREBASE_SERVICE_ACCOUNT_BASE64',
    'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
  ]
  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    console.error('[startup] FATAL — missing required env vars:', missing.join(', '))
    process.exit(1)
  }
  if (!process.env.FRONTEND_URL) {
    console.error('[startup] FATAL — FRONTEND_URL must be set in production (CORS will block all frontend requests)')
    process.exit(1)
  }
  if (!process.env.BUNNY_CDN_TOKEN_AUTH_KEY) {
    console.error('[startup] FATAL — BUNNY_CDN_TOKEN_AUTH_KEY must be set in production (premium content would be served unsigned)')
    process.exit(1)
  }
  if (!process.env.ADMIN_EMAILS) {
    console.warn('[startup] WARNING — ADMIN_EMAILS not set; admin access relies solely on Firebase custom claims')
  }
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express()
const PORT = process.env.PORT || 4000

// Render (and most PaaS hosts) sit behind a reverse proxy that sets X-Forwarded-For.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and
// crashes every rate-limited route (including /api/auth) in production.
app.set('trust proxy', 1)

// Attach a unique ID to every request — surfaced in error logs and X-Request-Id header.
app.use((req, res, next) => {
  req.id = randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
})

app.use(compression())
app.use(helmet())
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))

// Razorpay webhooks need the raw body for HMAC signature verification
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '1mb' }))

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Auth: tighter per-IP limit. Firebase blocks credential brute-force at source;
// this protects against token-replay abuse and hammering our login endpoint.
app.use('/api/auth', rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please wait and try again.', code: 'RATE_LIMITED' },
}))

// Admin routes: higher limit — dashboard polls frequently, users are trusted
app.use('/api/admin', rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             2000,
  standardHeaders: true,
  legacyHeaders:   false,
}))

// General API limit
app.use('/api', rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             1000,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please wait and try again.', code: 'RATE_LIMITED' },
}))

// ── DB guard ──────────────────────────────────────────────────────────────────
// Returns 503 immediately while MongoDB is not connected so clients know to retry.
app.use('/api', (req, res, next) => {
  if (!dbStatus.connected) {
    return res.status(503).json({
      error: 'Service temporarily unavailable. Please try again in a moment.',
      code:  'SERVICE_UNAVAILABLE',
    })
  }
  next()
})

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',            authRoutes)
app.use('/api/content',         contentRoutes)
app.use('/api/user',            userRoutes)
app.use('/api/payments',        paymentRoutes)
app.use('/api/search',          searchRoutes)
app.use('/api/admin',           adminRoutes)
app.use('/api/creator',         creatorRoutes)
app.use('/api/reels',           reelRoutes)
app.use('/api/recommendations', recommendationRoutes)

// Health endpoint — always responds, even while DB is disconnected
app.get('/health', (_req, res) => {
  const ok = dbStatus.connected
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db:     ok ? 'connected' : 'disconnected',
    ...(dbStatus.lastError ? { dbError: dbStatus.lastError } : {}),
    ts: new Date().toISOString(),
  })
})

app.use(errorHandler)

// ── Startup ───────────────────────────────────────────────────────────────────
// The HTTP server starts immediately so health checks and 503 responses work
// even while MongoDB is unreachable. DB-dependent startup tasks run once the
// first successful connection fires.

const server = app.listen(PORT, () => console.log(`Dhara backend → http://localhost:${PORT}`))

let startupTasksDone = false
mongoose.connection.on('connected', async () => {
  if (startupTasksDone) return   // don't re-run on reconnect after a transient drop
  startupTasksDone = true
  try {
    await syncAdminClaims()
  } catch (err) {
    console.error('[startup] syncAdminClaims failed:', err.message)
  }
  startSubscriptionExpiryJob()
  startEarningsJob()
})

connectMongoDB()

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Platforms like Render send SIGTERM before replacing the instance.
// We drain in-flight requests (including payment verifications) before exiting.
function shutdown(signal) {
  console.log(`[shutdown] ${signal} — draining connections…`)
  server.close(async () => {
    try {
      await mongoose.connection.close(false)
      console.log('[shutdown] MongoDB closed cleanly')
    } catch (err) {
      console.error('[shutdown] MongoDB close error:', err.message)
    }
    process.exit(0)
  })
  // Force-exit after 15 s if requests don't drain
  setTimeout(() => {
    console.error('[shutdown] timed out — forcing exit')
    process.exit(1)
  }, 15_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

// Catch async errors that nobody awaited and synchronous throws from background code.
// Without these, Node exits with code 1 and no graceful cleanup in production.
process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err)
  shutdown('uncaughtException')
})

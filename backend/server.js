// env.js must be the very first import — it populates process.env before anything reads it
import './src/config/env.js'
import express from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'

import './src/config/firebase.js'          // initialise Firebase Admin on startup
import { connectMongoDB, dbStatus } from './src/config/mongodb.js'
import { syncAdminClaims } from './src/config/adminSync.js'
import { startSubscriptionExpiryJob } from './src/config/subscriptionExpiry.js'

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

const app  = express()
const PORT = process.env.PORT || 4000

app.use(compression())
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))

// Razorpay webhooks need the raw body for HMAC signature verification
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())

// Admin routes get a much higher limit — they poll frequently and are trusted users
app.use('/api/admin', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
}))

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
}))

// ── DB guard — must come before route mounts ──────────────────────────────────
// Returns 503 immediately for any /api request while MongoDB is not connected.
// This prevents cryptic Mongoose timeout errors from reaching the client and
// tells callers explicitly that the error is transient and retryable.
app.use('/api', (req, res, next) => {
  if (!dbStatus.connected) {
    return res.status(503).json({
      error: 'Service temporarily unavailable. Please try again in a moment.',
      code:  'SERVICE_UNAVAILABLE',
    })
  }
  next()
})

app.use('/api/auth',            authRoutes)
app.use('/api/content',         contentRoutes)
app.use('/api/user',            userRoutes)
app.use('/api/payments',        paymentRoutes)
app.use('/api/search',          searchRoutes)
app.use('/api/admin',           adminRoutes)
app.use('/api/creator',         creatorRoutes)
app.use('/api/reels',           reelRoutes)
app.use('/api/recommendations', recommendationRoutes)

// Health endpoint — always responds, reports real DB status to load balancers/uptime monitors
app.get('/health', (_req, res) => {
  const db     = dbStatus.connected ? 'connected' : 'disconnected'
  const status = dbStatus.connected ? 'ok' : 'degraded'
  res.status(dbStatus.connected ? 200 : 503).json({
    status,
    db,
    ...(dbStatus.lastError ? { dbError: dbStatus.lastError } : {}),
    ts: new Date().toISOString(),
  })
})

app.use(errorHandler)

// ── Startup ───────────────────────────────────────────────────────────────────
// The HTTP server starts immediately so health checks and 503 responses work
// even while MongoDB is unreachable. DB-dependent startup tasks run once the
// first successful connection fires the 'connected' event.

app.listen(PORT, () => console.log(`Dhara backend → http://localhost:${PORT}`))

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
})

// Initiate connection — non-blocking, retries automatically on failure
connectMongoDB()

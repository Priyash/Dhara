// env.js must be the very first import — it populates process.env before anything reads it
import './src/config/env.js'
import express from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import './src/config/firebase.js'          // initialise Firebase Admin on startup
import { connectMongoDB } from './src/config/mongodb.js'
import { syncAdminClaims } from './src/config/adminSync.js'

import authRoutes    from './src/routes/auth.js'
import contentRoutes from './src/routes/content.js'
import userRoutes    from './src/routes/user.js'
import paymentRoutes from './src/routes/payments.js'
import searchRoutes  from './src/routes/search.js'
import adminRoutes   from './src/routes/admin.js'
import creatorRoutes from './src/routes/creator.js'
import { errorHandler } from './src/middleware/errorHandler.js'

const app  = express()
const PORT = process.env.PORT || 4000

// Gzip compress all responses — typically saves 70-80% on JSON API responses.
// Must come before routes so every handler benefits automatically.
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

// 1000 req/15min per IP — handles users behind shared NAT (office/campus/hostel).
// A heavy user session (load + browse + watch 30min) uses ~70 requests total,
// so 1000/15min supports ~14 simultaneous heavy users on the same IP before throttling.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
}))

app.use('/api/auth',     authRoutes)
app.use('/api/content',  contentRoutes)
app.use('/api/user',     userRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/search',   searchRoutes)
app.use('/api/admin',    adminRoutes)
app.use('/api/creator',  creatorRoutes)

app.get('/health', (_, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString() })
)

app.use(errorHandler)

connectMongoDB().then(async () => {
  await syncAdminClaims()
  app.listen(PORT, () => console.log(`Dhara backend → http://localhost:${PORT}`))
})

import mongoose from 'mongoose'

/**
 * Live connection state — read by the /health endpoint and the DB-guard middleware.
 * Never throws; the server stays up and returns 503 while this is false.
 */
export const dbStatus = {
  connected:  false,
  lastError:  null,
  retryCount: 0,
}

const MONGO_OPTIONS = {
  maxPoolSize:             20,
  minPoolSize:              2,
  serverSelectionTimeoutMS: 5_000,   // how long to wait per connection attempt
  socketTimeoutMS:         45_000,
  heartbeatFrequencyMS:    10_000,
}

const RETRY_INTERVAL_MS = 10_000   // wait 10 s before retrying a failed initial connect

let retryTimer = null

async function attempt() {
  clearTimeout(retryTimer)
  try {
    await mongoose.connect(process.env.MONGODB_URI, MONGO_OPTIONS)
    // 'connected' event fires immediately after this resolves — sets dbStatus.connected
  } catch (err) {
    dbStatus.connected = false
    dbStatus.lastError = err.message
    dbStatus.retryCount += 1
    console.error(`[mongodb] connection failed (attempt ${dbStatus.retryCount}): ${err.message}`)
    console.warn(`[mongodb] retrying in ${RETRY_INTERVAL_MS / 1000} s…`)
    retryTimer = setTimeout(attempt, RETRY_INTERVAL_MS)
  }
}

// ── Mongoose connection lifecycle events ──────────────────────────────────────

mongoose.connection.on('connected', () => {
  clearTimeout(retryTimer)   // cancel any pending retry — driver took care of it
  dbStatus.connected  = true
  dbStatus.lastError  = null
  console.log('[mongodb] connected')
})

// 'disconnected' fires on transient drops; the driver auto-reconnects, so we just flag it
mongoose.connection.on('disconnected', () => {
  dbStatus.connected = false
  console.warn('[mongodb] disconnected — driver will retry automatically')
})

// 'error' is emitted for non-recoverable errors (e.g. auth failure, bad URI)
mongoose.connection.on('error', (err) => {
  dbStatus.connected = false
  dbStatus.lastError = err.message
  console.error('[mongodb] error:', err.message)
})

// 'reconnected' fires after the driver recovers from a transient drop
mongoose.connection.on('reconnected', () => {
  dbStatus.connected = true
  dbStatus.lastError = null
  console.log('[mongodb] reconnected')
})

/**
 * Initiates a MongoDB connection without blocking the HTTP server.
 * On failure the server stays up and returns 503 until the retry loop succeeds.
 */
export async function connectMongoDB() {
  await attempt()
}

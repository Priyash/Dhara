import mongoose from 'mongoose'

/**
 * Tracks an in-progress stream session per user.
 * The frontend sends a heartbeat every 30 s; sessions without a heartbeat
 * for 2 minutes are automatically removed by the MongoDB TTL index.
 * This enforces the per-plan concurrent stream limit.
 */
const activeStreamSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId:       { type: String, required: true, unique: true },
  contentId:       { type: String, required: true },
  lastHeartbeatAt: { type: Date, default: Date.now },
})

// Auto-delete sessions that miss two consecutive heartbeats (> 2 minutes stale)
activeStreamSchema.index({ lastHeartbeatAt: 1 }, { expireAfterSeconds: 120 })

export const ActiveStream = mongoose.model('ActiveStream', activeStreamSchema)

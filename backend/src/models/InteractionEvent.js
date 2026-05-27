import mongoose from 'mongoose'

export const INTERACTION_EVENT_TYPES = [
  'impression',
  'play',
  'view_3s',
  'view_50',
  'completion',
  'like',
  'skip',
  'share',
]

const interactionEventSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    sessionId: { type: String, default: '', index: true },

    itemType:  { type: String, enum: ['content', 'reel'], default: 'content', index: true },
    itemId:    { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    eventType: { type: String, enum: INTERACTION_EVENT_TYPES, required: true, index: true },

    episodeNumber: { type: Number, default: null },
    source:       { type: String, default: '' },
    positionSecs: { type: Number, min: 0, default: 0 },
    durationSecs: { type: Number, min: 0, default: 0 },
    percent:      { type: Number, min: 0, max: 1, default: 0 },

    // Used for server-side dedup of high-weight events.
    // Format: `u:{userId}:{itemId}:{eventType}[:{YYYY-MM-DD}]`  (logged-in)
    //         `s:{sessionId}:{itemId}:{eventType}[:{YYYY-MM-DD}]` (anonymous)
    //         null (impression and other non-deduped events)
    // The sparse unique index excludes null so non-deduped events accumulate freely.
    dedupKey: { type: String, default: null },
  },
  { timestamps: true }
)

interactionEventSchema.index({ userId: 1, createdAt: -1 })
interactionEventSchema.index({ sessionId: 1, createdAt: -1 })
interactionEventSchema.index({ itemType: 1, itemId: 1, eventType: 1, createdAt: -1 })
interactionEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 })
// Sparse unique index: documents with dedupKey '' are excluded from uniqueness checks.
interactionEventSchema.index({ dedupKey: 1 }, { unique: true, sparse: true })

export const InteractionEvent = mongoose.model('InteractionEvent', interactionEventSchema)

import mongoose from 'mongoose'

export const INTERACTION_EVENT_TYPES = [
  'impression',
  'click',        // poster clicked — the conversion half of thumbnail CTR (impression → click)
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

    seasonNumber:  { type: Number, default: null },
    episodeNumber: { type: Number, default: null },
    source:       { type: String, default: '' },

    // Which ThumbnailVariant was on screen when this event fired, for artwork
    // A/B attribution. null for the vast majority of events (no variant served),
    // so the index below is sparse. Note: events carry the collection's 30-day
    // TTL, so per-variant stats are a trailing-30-day window. See
    // docs/thumbnail-trailer-pipeline.md.
    variantId:    { type: mongoose.Schema.Types.ObjectId, ref: 'ThumbnailVariant', default: null },

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
// Per-variant attribution rollup (computed on read). PARTIAL, not sparse: a
// compound sparse index would still index every event (eventType is always
// present), defeating the point. The partial filter indexes only the tiny
// fraction of events that actually carried a served variant.
interactionEventSchema.index(
  { variantId: 1, eventType: 1 },
  { partialFilterExpression: { variantId: { $type: 'objectId' } } }
)
// 30-day TTL — at 500K users * 5 events/day = 2.5M events/day; 180-day retention
// would accumulate 450M+ docs. 30 days gives enough signal for recommendations
// while keeping the collection at ~75M docs max.
interactionEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })
// Partial unique index: only enforce uniqueness when dedupKey is a non-empty string.
// sparse:true would still index null (field exists but is null), causing dup key errors.
interactionEventSchema.index(
  { dedupKey: 1 },
  { unique: true, partialFilterExpression: { dedupKey: { $type: 'string', $gt: '' } } }
)

export const InteractionEvent = mongoose.model('InteractionEvent', interactionEventSchema)

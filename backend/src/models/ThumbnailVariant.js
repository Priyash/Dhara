import mongoose from 'mongoose'

/**
 * A single artwork variant for a Content title or Reel.
 *
 * This is the foundation of the thumbnail A/B pipeline (see
 * docs/thumbnail-trailer-pipeline.md). It is deliberately minimal for v1:
 *   - 3 states only — `candidate` (generated/seeded, awaiting review),
 *     `live` (eligible to be served on browse rails), `rejected` (discarded).
 *     `approved`/`archived` are intentionally NOT added until a workflow needs
 *     them.
 *   - No denormalized stats subdocument. Per-variant impression/play/completion
 *     counts are computed ON READ by aggregating InteractionEvent.variantId, so
 *     there is nothing to keep in sync. A rollup job is a later optimisation,
 *     only if read-time aggregation becomes slow.
 *
 * Dormant by default: until an admin sets a variant `live`, nothing about
 * serving changes — titles keep shipping their existing Content.posterUrl /
 * Reel.thumbnailUrl. Activation (round-robin serving + frontend attribution)
 * is a separate increment.
 */
const thumbnailVariantSchema = new mongoose.Schema(
  {
    itemType: { type: String, enum: ['content', 'reel'], required: true },
    itemId:   { type: mongoose.Schema.Types.ObjectId, required: true },

    // Episode-level artwork is optional; null = title-level.
    seasonNumber:  { type: Number, default: null },
    episodeNumber: { type: Number, default: null },

    imageUrl: { type: String, required: true, trim: true },   // CDN/Cloudinary URL of the composited artwork
    label:    { type: String, default: '', trim: true, maxlength: 120 },  // human note e.g. "close-up, warm grade"

    // How this variant was produced. v1 seeds are 'manual'; the extraction +
    // compositing workers will write 'frame' (and later 'ai-genart').
    source:        { type: String, enum: ['manual', 'frame', 'ai-genart'], default: 'manual' },
    sourceFrameTs: { type: Number, default: null },   // seconds into footage, for 'frame' source
    templateId:    { type: String, default: '' },     // which layout template produced it

    status: { type: String, enum: ['candidate', 'live', 'rejected'], default: 'candidate' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

// Serving lookup: "give me the live variants for this item".
thumbnailVariantSchema.index({ itemType: 1, itemId: 1, status: 1 })

export const ThumbnailVariant = mongoose.model('ThumbnailVariant', thumbnailVariantSchema)

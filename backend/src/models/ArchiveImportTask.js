import mongoose from 'mongoose'

/**
 * A single archive.org item queued for import. Persisting the queue (rather than
 * holding it in memory) makes bulk imports crash-resumable: if the backend
 * restarts mid-batch, pending tasks are still here and the worker drains them on
 * startup. Tasks are claimed atomically (pending → processing) so multiple
 * instances never process the same item twice.
 */
const archiveImportTaskSchema = new mongoose.Schema(
  {
    batchId:         { type: String, required: true, index: true },
    item:            { type: mongoose.Schema.Types.Mixed, required: true }, // manifest item: archiveId/type/title/seasons…
    title:           { type: String, default: '' },
    allowUnlicensed: { type: Boolean, default: false },
    createdByEmail:  { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'done', 'skipped', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    claimedAt:  { type: Date, default: null },   // when a worker last claimed it (for stale reclaim)
    attempts:   { type: Number, default: 0 },
    error:      { type: String, default: '' },
    reason:     { type: String, default: '' },   // skip reason
    contentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Content', default: null },
  },
  { timestamps: true }
)

archiveImportTaskSchema.index({ status: 1, createdAt: 1 })
// Auto-purge finished tasks after 30 days.
archiveImportTaskSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

export const ArchiveImportTask = mongoose.model('ArchiveImportTask', archiveImportTaskSchema)

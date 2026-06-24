import mongoose from 'mongoose'

/**
 * A title surfaced by the scheduled archive.org discovery job for admin review.
 * Discovery never imports automatically — an admin imports or dismisses each one.
 */
const archiveCandidateSchema = new mongoose.Schema(
  {
    archiveId:    { type: String, required: true, unique: true, trim: true },
    title:        { type: String, default: '' },
    year:         { type: Number, default: null },
    language:     { type: String, default: '' },
    licenseLabel: { type: String, default: '' },
    licensed:     { type: Boolean, default: false },
    thumbUrl:     { type: String, default: '' },
    detailUrl:    { type: String, default: '' },
    status:       { type: String, enum: ['new', 'dismissed', 'imported'], default: 'new', index: true },
    discoveredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

archiveCandidateSchema.index({ status: 1, discoveredAt: -1 })

export const ArchiveCandidate = mongoose.model('ArchiveCandidate', archiveCandidateSchema)

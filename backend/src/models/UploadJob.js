import mongoose from 'mongoose'

const uploadJobSchema = new mongoose.Schema(
  {
    createdByEmail: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'StreamCollection', required: true },
    collectionName: { type: String, default: '' },
    bunnyCollectionId: { type: String, required: true, trim: true },
    // Exactly one of contentId or reelId must be set — enforced at the route layer.
    contentId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Content', default: null },
    reelId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Reel',    default: null },
    seasonNumber:    { type: Number,  default: null },  // null = main content video (Film/Documentary)
    episodeNumber:   { type: Number,  default: null },  // null = main content video; ignored for reels
    episodeTitle:    { type: String,  default: '' },
    episodeDuration: { type: String,  default: '' },    // e.g. "42m"
    bunnyVideoId: { type: String, default: '' },
    fileName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['awaiting_file', 'queued', 'uploading', 'processing', 'ready', 'failed'],
      default: 'awaiting_file',
      index: true,
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    error: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { timestamps: true }
)

uploadJobSchema.index({ status: 1, updatedAt: -1 })

export const UploadJob = mongoose.model('UploadJob', uploadJobSchema)

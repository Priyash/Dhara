import mongoose from 'mongoose'

const uploadJobSchema = new mongoose.Schema(
  {
    createdByEmail: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'StreamCollection', required: true },
    collectionName: { type: String, default: '' },
    bunnyCollectionId: { type: String, required: true, trim: true },
    contentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', default: null },
    episodeNumber: { type: Number, default: null },
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

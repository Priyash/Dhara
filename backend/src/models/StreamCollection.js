import mongoose from 'mongoose'

const streamCollectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    bunnyCollectionId: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

streamCollectionSchema.index({ name: 1 })

export const StreamCollection = mongoose.model('StreamCollection', streamCollectionSchema)

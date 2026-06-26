import mongoose from 'mongoose'

const curatedShelfSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true },
    tagline:      { type: String, default: '' },
    backdropUrl:  { type: String, default: '' },
    accentColor:  { type: String, default: '#f59e0b' },
    contentIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Content' }],
    displayOrder: { type: Number, default: 0 },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
)

curatedShelfSchema.index({ isActive: 1, displayOrder: 1 })

export const CuratedShelf = mongoose.model('CuratedShelf', curatedShelfSchema)

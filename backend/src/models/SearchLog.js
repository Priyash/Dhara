import mongoose from 'mongoose'

const searchLogSchema = new mongoose.Schema(
  {
    query:       { type: String, required: true },
    lang:        { type: String, default: null },
    resultCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

searchLogSchema.index({ query: 1, createdAt: -1 })
searchLogSchema.index({ resultCount: 1, createdAt: -1 })
searchLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

export const SearchLog = mongoose.model('SearchLog', searchLogSchema)

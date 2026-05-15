import { Schema, model } from 'mongoose'

const contentRankSnapshotSchema = new Schema({
  creatorId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  snapshotDate: { type: String, required: true }, // 'YYYY-MM-DD' in IST
  rankings: [{
    contentId: { type: Schema.Types.ObjectId, ref: 'Content' },
    rank:      { type: Number },
    viewCount: { type: Number },
  }],
}, { timestamps: false })

contentRankSnapshotSchema.index({ creatorId: 1, snapshotDate: 1 }, { unique: true })

export const ContentRankSnapshot = model('ContentRankSnapshot', contentRankSnapshotSchema)

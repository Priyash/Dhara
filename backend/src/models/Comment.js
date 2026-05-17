import mongoose from 'mongoose'

export const COMMENT_MAX_LENGTH = 500

const commentSchema = new mongoose.Schema(
  {
    reelId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true, index: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text:      { type: String, required: true, maxlength: COMMENT_MAX_LENGTH },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
)

commentSchema.index({ reelId: 1, createdAt: -1 })

export const Comment = mongoose.model('Comment', commentSchema)

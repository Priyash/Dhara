import { Schema, model } from 'mongoose'

const userRatingSchema = new Schema({
  userId:    { type: Schema.Types.ObjectId, ref: 'User',    required: true },
  contentId: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
  score:     { type: Number, min: 1, max: 5, required: true },
}, { timestamps: true })

userRatingSchema.index({ userId: 1, contentId: 1 }, { unique: true })
userRatingSchema.index({ contentId: 1 })

export const UserRating = model('UserRating', userRatingSchema)

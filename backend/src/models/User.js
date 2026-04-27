import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    firebaseUid:           { type: String, required: true, unique: true, index: true },
    email:                 { type: String, required: true },
    emailVerified:         { type: Boolean, default: false },
    displayName:           { type: String, default: '' },
    photoURL:              { type: String, default: '' },
    lastLoginAt:           { type: Date, default: null },
    isSubscribed:          { type: Boolean, default: false },
    subscriptionPlan:      { type: String, enum: ['monthly', 'annual', 'family', null], default: null },
    subscriptionExpiresAt: { type: Date, default: null },
    watchlist:             [{ type: String }],  // MongoDB Content _id strings
  },
  { timestamps: true }
)

userSchema.virtual('isSubscriptionActive').get(function () {
  return this.isSubscribed &&
    (!this.subscriptionExpiresAt || this.subscriptionExpiresAt > new Date())
})

export const User = mongoose.model('User', userSchema)

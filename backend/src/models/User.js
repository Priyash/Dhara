import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    firebaseUid:            { type: String, required: true, unique: true, index: true },
    email:                  { type: String, required: true },
    emailVerified:          { type: Boolean, default: false },
    displayName:            { type: String, default: '' },
    photoURL:               { type: String, default: '' },
    lastLoginAt:            { type: Date, default: null },

    // Subscription state machine: free → trial → active → grace → lapsed
    subscriptionStatus:     { type: String, enum: ['free', 'trial', 'active', 'grace', 'lapsed'], default: 'free' },
    subscriptionPlan:       { type: String, enum: ['monthly', 'annual', 'family', null], default: null },
    subscriptionStartedAt:  { type: Date, default: null },
    subscriptionExpiresAt:  { type: Date, default: null },
    trialEndsAt:            { type: Date, default: null },
    graceEndsAt:            { type: Date, default: null },
    razorpaySubscriptionId: { type: String, default: null },

    watchlist:              [{ type: String }],
    likedContent:           [{ type: String }],
    dislikedContent:        [{ type: String }],

    // Creator Studio
    creatorStatus:          { type: String, enum: ['none', 'applied', 'approved', 'rejected'], default: 'none' },
    isCreator:              { type: Boolean, default: false },
    creatorProfile: {
      studioName:   { type: String, default: '' },
      bio:          { type: String, default: '' },
      portfolioUrl: { type: String, default: '' },
      appliedAt:    { type: Date,   default: null },
    },
    creatorRejectionReason: { type: String, default: '' },
  },
  { timestamps: true }
)

userSchema.virtual('isSubscriptionActive').get(function () {
  const now = new Date()
  switch (this.subscriptionStatus) {
    case 'trial':  return Boolean(this.trialEndsAt  && this.trialEndsAt  > now)
    case 'active': return !this.subscriptionExpiresAt || this.subscriptionExpiresAt > now
    case 'grace':  return Boolean(this.graceEndsAt  && this.graceEndsAt  > now)
    default:       return false
  }
})

export const User = mongoose.model('User', userSchema)

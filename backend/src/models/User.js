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
    watchProgress:          [{
      contentId:     { type: String, required: true },
      seasonNumber:  { type: Number, default: null },   // null = not a series
      episodeNumber: { type: Number, default: null },
      positionSecs:  { type: Number, default: 0 },
      durationSecs:  { type: Number, default: 0 },
      updatedAt:     { type: Date, default: () => new Date() },
    }],

    // Creator Studio
    creatorStatus:          { type: String, enum: ['none', 'applied', 'approved', 'rejected'], default: 'none' },
    isCreator:              { type: Boolean, default: false },
    creatorProfile: {
      studioName:    { type: String,   default: '' },
      bio:           { type: String,   default: '' },
      portfolioUrl:  { type: String,   default: '' },
      sampleWorkUrl: { type: String,   default: '' },  // link to reel / channel / past film
      contentTypes:  { type: [String], default: [] },  // ['Film','Series','Documentary']
      appliedAt:     { type: Date,     default: null },
    },
    creatorRejectionReason: { type: String, default: '' },
    creatorRejectedAt:      { type: Date,   default: null },
    creatorRejectionCount:  { type: Number, default: 0 },
    creatorReapplyAfter:    { type: Date,   default: null },  // set after 3+ rejections
    renewalReminderSentAt:  { type: Date,   default: null },  // track last renewal email
    creatorTier:            { type: String, default: 'Newcomer' },  // last known tier; used to detect advancement
    trialUsedAt:            { type: Date,   default: null },  // set once when trial activates; never cleared — one trial per account

    // Payout details — creator-entered bank/UPI info used by the (gated) RazorpayX
    // auto-payout job. Until a creator fills this in, they're simply excluded from
    // auto-runs and stay on the existing manual admin payout flow.
    creatorPayoutDetails: {
      method:            { type: String, enum: ['bank', 'upi', null], default: null },
      accountHolderName: { type: String, default: '' },
      accountNumber:     { type: String, default: '' },
      ifsc:              { type: String, default: '' },
      upiId:             { type: String, default: '' },
      razorpayContactId:     { type: String, default: '' },  // RazorpayX contact, created lazily on first auto-payout
      razorpayFundAccountId: { type: String, default: '' },  // RazorpayX fund account, recreated whenever details change
      updatedAt:         { type: Date, default: null },
    },
  },
  { timestamps: true }
)

userSchema.index({ email: 1 })
userSchema.index({ subscriptionStatus: 1, subscriptionExpiresAt: 1 })
userSchema.index({ lastLoginAt: 1 })

userSchema.virtual('isSubscriptionActive').get(function () {
  const now = new Date()
  switch (this.subscriptionStatus) {
    case 'trial':  return Boolean(this.trialEndsAt  && this.trialEndsAt  > now)
    case 'active': return Boolean(this.subscriptionExpiresAt) && this.subscriptionExpiresAt > now
    case 'grace':  return Boolean(this.graceEndsAt  && this.graceEndsAt  > now)
    default:       return false
  }
})

export const User = mongoose.model('User', userSchema)

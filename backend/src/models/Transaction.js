import mongoose from 'mongoose'

const transactionSchema = new mongoose.Schema(
  {
    // Who paid
    userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userEmail:    { type: String, required: true },

    // What they bought
    plan:         { type: String, enum: ['monthly', 'annual', 'family'], required: true },
    amount:       { type: Number, required: true },   // in paise (smallest currency unit)
    currency:     { type: String, default: 'INR' },

    // Payment gateway details
    gateway:      { type: String, default: 'razorpay' },
    orderId:      { type: String, required: true, index: true },
    paymentId:    { type: String, default: null },     // filled on success; null until paid
    subscriptionId: { type: String, default: null },  // for recurring plans

    // Outcome
    status:       { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending', index: true },
    failureReason:{ type: String, default: '' },

    // Metadata snapshot at time of payment
    planSnapshot: {
      label:  { type: String },
      days:   { type: Number },
      amount: { type: Number },
    },
  },
  { timestamps: true }
)

// Unique index on paymentId — only for documents that have a real payment ID.
// Partial filter excludes pending records (paymentId = null) and prevents the
// /verify-subscription race condition from creating duplicate paid records.
transactionSchema.index(
  { paymentId: 1 },
  { unique: true, partialFilterExpression: { paymentId: { $type: 'string', $gt: '' } } }
)

// Revenue query indexes
transactionSchema.index({ status: 1, createdAt: -1 })
transactionSchema.index({ userId: 1, createdAt: -1 })

export const Transaction = mongoose.model('Transaction', transactionSchema)

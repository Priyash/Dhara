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
    paymentId:    { type: String, default: '' },      // filled on success
    subscriptionId: { type: String, default: '' },    // for recurring plans

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

// Useful indexes for revenue queries
transactionSchema.index({ status: 1, createdAt: -1 })
transactionSchema.index({ userId: 1, createdAt: -1 })

export const Transaction = mongoose.model('Transaction', transactionSchema)

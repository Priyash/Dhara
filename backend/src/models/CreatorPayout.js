import mongoose from 'mongoose'

/**
 * One record per payout batch issued to a creator.
 * Links back to the CreatorEarning records it settles.
 */
const creatorPayoutSchema = new mongoose.Schema(
  {
    creatorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amountPaise:  { type: Number, required: true },   // total in paise
    earningIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'CreatorEarning' }],

    method:       { type: String, default: 'Bank Transfer' },  // 'Bank Transfer', 'UPI', etc.
    status:       { type: String, enum: ['requested', 'processing', 'paid', 'failed'], default: 'processing' },
    paidAt:       { type: Date, default: null },
    referenceId:  { type: String, default: '' },   // bank/UPI transaction reference
    notes:        { type: String, default: '' },
    initiatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

creatorPayoutSchema.index({ creatorId: 1, status: 1 })
creatorPayoutSchema.index({ creatorId: 1, createdAt: -1 })

export const CreatorPayout = mongoose.model('CreatorPayout', creatorPayoutSchema)

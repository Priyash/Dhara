import mongoose from 'mongoose'

/**
 * One record per (creator × content × month).
 * Created by the admin "calculate earnings" job at end of each month.
 */
const creatorEarningSchema = new mongoose.Schema(
  {
    creatorId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
    contentId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Content', required: true },

    month:           { type: Number, required: true, min: 1, max: 12 },  // 1–12
    year:            { type: Number, required: true },

    viewCount:       { type: Number, default: 0 },   // views credited to this period
    ratePerViewPaise:{ type: Number, default: 50  },  // ₹0.50 = 50 paise default

    grossAmountPaise:{ type: Number, default: 0 },
    revenueSharePct: { type: Number, default: 70  },  // creator's share %
    netAmountPaise:  { type: Number, default: 0 },    // grossAmount × revenueShare/100

    status:   { type: String, enum: ['pending', 'paid'], default: 'pending' },
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreatorPayout', default: null },
    calculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

creatorEarningSchema.index({ creatorId: 1, year: 1, month: 1 })
creatorEarningSchema.index({ creatorId: 1, status: 1 })
// unique: true prevents duplicate calculation for the same content + period
creatorEarningSchema.index({ contentId: 1, year: 1, month: 1 }, { unique: true })

export const CreatorEarning = mongoose.model('CreatorEarning', creatorEarningSchema)

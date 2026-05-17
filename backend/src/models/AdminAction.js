import mongoose from 'mongoose'

const adminActionSchema = new mongoose.Schema(
  {
    adminEmail:  { type: String, required: true, index: true },
    adminUid:    { type: String, default: '' },
    action:      { type: String, required: true, index: true },
    targetType:  { type: String, default: '' },   // 'user' | 'content' | 'payout' | 'config'
    targetId:    { type: mongoose.Schema.Types.ObjectId, default: null },
    targetLabel: { type: String, default: '' },    // human-readable: title, studio name, email
    notes:       { type: String, default: '' },
    metadata:    { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

adminActionSchema.index({ targetType: 1, targetId: 1 })
adminActionSchema.index({ createdAt: -1 })

export const AdminAction = mongoose.model('AdminAction', adminActionSchema)

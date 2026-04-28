import mongoose from 'mongoose'

const paymentConfigSchema = new mongoose.Schema(
  {
    _id:            { type: String, default: 'singleton' },
    activeProvider: { type: String, default: 'razorpay' },
    mode:           { type: String, enum: ['test', 'live'], default: 'test' },
  },
  { timestamps: true }
)

paymentConfigSchema.statics.getConfig = async function () {
  let config = await this.findById('singleton')
  if (!config) config = await this.create({ _id: 'singleton' })
  return config
}

export const PaymentConfig = mongoose.model('PaymentConfig', paymentConfigSchema)

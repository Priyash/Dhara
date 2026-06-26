import mongoose from 'mongoose'

const MAX_RATE = 1000   // sanity ceiling — no real INR-to-X rate is anywhere close to this

/**
 * Admin-configurable INR → foreign-currency display rates. Display-only:
 * subscribers are always charged in INR via Razorpay; this only controls the
 * "~ $1.19" hint shown next to the INR price for a detected country. A
 * static table (rather than a live FX API) avoids a third-party dependency
 * and the risk of rates silently drifting from what's actually charged.
 */
const currencyRateSchema = new mongoose.Schema(
  {
    currencyCode: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3, match: /^[A-Z]{3}$/ },
    symbol:       { type: String, default: '', trim: true, maxlength: 10 },
    rateFromInr:  { type: Number, required: true, min: 0, max: MAX_RATE },  // units of this currency per 1 INR
  },
  { _id: false }
)

const currencyConfigSchema = new mongoose.Schema(
  {
    _id:   { type: String, default: 'singleton' },
    rates: { type: [currencyRateSchema], default: [] },
  },
  { timestamps: true }
)

currencyConfigSchema.statics.getConfig = async function () {
  let config = await this.findById('singleton')
  if (!config) config = await this.create({ _id: 'singleton' })
  return config
}

/** Builds a Map<currencyCode, {symbol, rateFromInr}> for O(1) lookups. */
currencyConfigSchema.statics.toRateMap = function (config) {
  const map = new Map()
  for (const r of config?.rates || []) map.set(r.currencyCode, { symbol: r.symbol, rateFromInr: r.rateFromInr })
  return map
}

export const CurrencyConfig = mongoose.model('CurrencyConfig', currencyConfigSchema)

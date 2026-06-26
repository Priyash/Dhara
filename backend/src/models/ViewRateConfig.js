import mongoose from 'mongoose'

/**
 * Admin-configurable, country-tiered rate paid to creators per view.
 * Singleton document — one row per country code plus a fallback default
 * for any country without an explicit entry. Always denominated in paise
 * (the payout currency, INR) so calculation never depends on a live FX
 * rate: admin sets "₹0.80 for US views" directly, not "$0.01" + conversion.
 */
const MAX_RATE_PAISE = 100_000   // ₹1,000/view — sanity ceiling matching the admin route's validation

const countryRateSchema = new mongoose.Schema(
  {
    countryCode: { type: String, required: true, uppercase: true, trim: true, minlength: 2, maxlength: 2, match: /^[A-Z]{2}$/ },
    countryName: { type: String, default: '', trim: true, maxlength: 60 },
    ratePaise:   { type: Number, required: true, min: 0, max: MAX_RATE_PAISE },
  },
  { _id: false }
)

const viewRateConfigSchema = new mongoose.Schema(
  {
    _id:              { type: String, default: 'singleton' },
    defaultRatePaise: { type: Number, default: 50, min: 0, max: MAX_RATE_PAISE },  // ₹0.50 — used for any country with no explicit rate
    countryRates:     { type: [countryRateSchema], default: [] },
  },
  { timestamps: true }
)

viewRateConfigSchema.statics.getConfig = async function () {
  let config = await this.findById('singleton')
  if (!config) config = await this.create({ _id: 'singleton' })
  return config
}

/** Builds a Map<countryCode, ratePaise> for O(1) lookups during earnings calc. */
viewRateConfigSchema.statics.toRateMap = function (config) {
  const map = new Map()
  for (const r of config?.countryRates || []) map.set(r.countryCode, r.ratePaise)
  return map
}

export const ViewRateConfig = mongoose.model('ViewRateConfig', viewRateConfigSchema)

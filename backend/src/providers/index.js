import { PaymentConfig } from '../models/PaymentConfig.js'
import { createRazorpayAdapter } from './razorpay.js'
import { isPayoutConfigured } from './razorpayPayout.js'

/**
 * Registry of installed provider adapters.
 * To add a new provider: implement the interface (see providers/razorpay.js)
 * and register it here. The admin can then activate it from the dashboard.
 */
const ADAPTERS = {
  razorpay: createRazorpayAdapter,
}

export const SUPPORTED_PROVIDERS = Object.keys(ADAPTERS)

/**
 * Returns the currently active payment adapter + config document.
 * Throws if the active provider has no installed adapter.
 */
export async function getActiveProvider() {
  const config = await PaymentConfig.getConfig()
  const factory = ADAPTERS[config.activeProvider]
  if (!factory) {
    throw new Error(
      `Payment provider "${config.activeProvider}" is not installed. ` +
      `Installed: ${SUPPORTED_PROVIDERS.join(', ')}`
    )
  }
  return { adapter: factory(), config }
}

/**
 * Returns status info for each known provider — used by the admin UI.
 * Never exposes secret values; only masked public keys and boolean flags.
 */
export function getProviderStatus(backendUrl = '') {
  return {
    razorpay: {
      displayName: 'Razorpay',
      configured:  Boolean(
        process.env.RAZORPAY_KEY_ID &&
        process.env.RAZORPAY_KEY_SECRET &&
        process.env.RAZORPAY_WEBHOOK_SECRET
      ),
      publicKeyHint: process.env.RAZORPAY_KEY_ID
        ? `${process.env.RAZORPAY_KEY_ID.slice(0, 12)}…`
        : null,
      webhookUrl: `${backendUrl}/api/payments/webhook`,
    },
  }
}

/**
 * Status of the RazorpayX auto-payout adapter, for the admin Revenue UI.
 * Distinct from getProviderStatus() above — that's the subscription/payment
 * provider, this is the (gated, dormant-by-default) creator payout rail.
 */
export function getPayoutProviderStatus() {
  return {
    configured: isPayoutConfigured(),
    accountNumberHint: process.env.RAZORPAY_X_ACCOUNT_NUMBER
      ? `••••${String(process.env.RAZORPAY_X_ACCOUNT_NUMBER).slice(-4)}`
      : null,
  }
}

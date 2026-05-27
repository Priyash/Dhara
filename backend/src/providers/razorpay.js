import Razorpay from 'razorpay'
import { createHmac, timingSafeEqual } from 'crypto'

function safeCompare(a, b) {
  const ba = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Razorpay adapter — implements the Dhara payment provider interface.
 *
 * Interface contract (all adapters must expose):
 *   name                  string
 *   displayName           string
 *   publicKey             string   — safe to send to frontend
 *   createOrder(opts)     → { orderId, amount, currency }
 *   fetchOrder(orderId)   → Razorpay order object
 *   verifyPaymentSignature({ orderId, paymentId, signature }) → boolean
 *   verifyWebhookSignature({ body, signature })               → boolean
 *   createSubscription({ planId, totalCount, notes })         → subscription object
 */
export function createRazorpayAdapter() {
  const client = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })

  return {
    name:        'razorpay',
    displayName: 'Razorpay',
    publicKey:   process.env.RAZORPAY_KEY_ID || '',

    async createOrder({ amount, currency, receipt, notes }) {
      const order = await client.orders.create({ amount, currency, receipt, notes })
      return { orderId: order.id, amount: order.amount, currency: order.currency }
    },

    async fetchOrder(orderId) {
      return client.orders.fetch(orderId)
    },

    verifyPaymentSignature({ orderId, paymentId, signature }) {
      const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex')
      return safeCompare(expected, signature || '')
    },

    verifyWebhookSignature({ body, signature }) {
      const expected = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(body)
        .digest('hex')
      return safeCompare(expected, signature || '')
    },

    async createSubscription({ planId, totalCount, notes }) {
      return client.subscriptions.create({
        plan_id:     planId,
        total_count: totalCount,
        quantity:    1,
        notes,
      })
    },

    async cancelSubscription(subscriptionId) {
      return client.subscriptions.cancel(subscriptionId, { cancel_at_cycle_end: 0 })
    },

    verifySubscriptionSignature({ paymentId, subscriptionId, signature }) {
      const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${paymentId}|${subscriptionId}`)
        .digest('hex')
      return safeCompare(expected, signature || '')
    },
  }
}

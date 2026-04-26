import { Router } from 'express'
import { createHmac } from 'crypto'
import { razorpay } from '../config/razorpay.js'
import { User } from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const PLANS = {
  monthly: { amount: 9900,  days: 30  },  // ₹99  in paise
  annual:  { amount: 59900, days: 365 },  // ₹599 in paise
  family:  { amount: 99900, days: 365 },  // ₹999 in paise
}

/**
 * POST /api/payments/create-order
 * Creates a Razorpay order. Returns orderId + amount to the frontend
 * so it can open the Razorpay checkout modal.
 */
router.post('/create-order', requireAuth, async (req, res, next) => {
  try {
    const { plan } = req.body
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan. Choose monthly, annual, or family.' })

    const order = await razorpay.orders.create({
      amount:   PLANS[plan].amount,
      currency: 'INR',
      receipt:  `dhara_${req.user._id.toString().slice(-8)}_${Date.now()}`,
      notes:    { userId: req.user._id.toString(), plan },
    })

    res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      plan,
      keyId:    process.env.RAZORPAY_KEY_ID, // frontend needs this for checkout
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/payments/webhook
 * Razorpay calls this after a successful payment.
 * Verifies HMAC signature, then activates the user's subscription.
 */
router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature']
    const expected  = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body) // raw Buffer — must not parse as JSON before this
      .digest('hex')

    if (signature !== expected) {
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const event = JSON.parse(req.body.toString())

    if (event.event === 'payment.captured') {
      const { userId, plan } = event.payload.payment.entity.notes || {}
      if (userId && PLANS[plan]) {
        const expiresAt = new Date(Date.now() + PLANS[plan].days * 86_400_000)
        await User.findByIdAndUpdate(userId, {
          isSubscribed:          true,
          subscriptionPlan:      plan,
          subscriptionExpiresAt: expiresAt,
        })
      }
    }

    if (event.event === 'subscription.cancelled') {
      const { userId } = event.payload.subscription.entity.notes || {}
      if (userId) {
        await User.findByIdAndUpdate(userId, {
          isSubscribed:          false,
          subscriptionPlan:      null,
          subscriptionExpiresAt: null,
        })
      }
    }

    res.json({ received: true })
  } catch (err) {
    next(err)
  }
})

export default router

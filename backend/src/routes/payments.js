import { Router } from 'express'
import { User } from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { getActiveProvider } from '../providers/index.js'

const router = Router()

const PLANS = {
  monthly: { amount: 9900,  days: 30  },  // ₹99
  annual:  { amount: 59900, days: 365 },  // ₹599
  family:  { amount: 99900, days: 365 },  // ₹999
}

const GRACE_DAYS = 3

function planExpiresAt(plan) {
  return new Date(Date.now() + PLANS[plan].days * 86_400_000)
}

/**
 * POST /api/payments/create-order
 * Creates a payment order via the active provider. Returns orderId + amount +
 * the provider's public key so the frontend can open the checkout modal.
 */
router.post('/create-order', requireAuth, async (req, res, next) => {
  try {
    const { plan } = req.body
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' })

    const { adapter } = await getActiveProvider()

    const order = await adapter.createOrder({
      amount:   PLANS[plan].amount,
      currency: 'INR',
      receipt:  `dhara_${req.user._id.toString().slice(-8)}_${Date.now()}`,
      notes:    { userId: req.user._id.toString(), plan },
    })

    res.json({
      orderId:  order.orderId,
      amount:   order.amount,
      currency: order.currency,
      plan,
      keyId:    adapter.publicKey,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/payments/verify
 * Called by the frontend immediately after checkout succeeds.
 * Performs strict backend verification before activating the subscription:
 *   1. HMAC signature verified by the active provider adapter
 *   2. Order fetched from the provider — status must be 'paid'
 *   3. Amount on the order must exactly match the declared plan amount
 *   4. Order notes.userId must match the authenticated user
 */
router.post('/verify', requireAuth, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan) {
      return res.status(400).json({ error: 'Missing required payment fields' })
    }
    if (!PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    const { adapter } = await getActiveProvider()

    // 1. Verify HMAC signature via the active provider
    const signatureValid = adapter.verifyPaymentSignature({
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })
    if (!signatureValid) {
      return res.status(400).json({ error: 'Payment verification failed' })
    }

    // 2 & 3. Fetch the actual order and validate status + amount
    const order = await adapter.fetchOrder(razorpay_order_id)
    if (order.status !== 'paid') {
      return res.status(400).json({ error: 'Order has not been paid' })
    }
    if (order.amount !== PLANS[plan].amount) {
      return res.status(400).json({ error: 'Payment amount does not match selected plan' })
    }

    // 4. Ensure this order was created for the authenticated user
    if (order.notes?.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Order does not belong to this account' })
    }

    // All checks passed — activate subscription
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          subscriptionStatus:    'active',
          subscriptionPlan:      plan,
          subscriptionStartedAt: new Date(),
          subscriptionExpiresAt: planExpiresAt(plan),
          graceEndsAt:           null,
        },
      },
      { new: true }
    )

    res.json({
      success:               true,
      isSubscribed:          user.isSubscriptionActive,
      subscriptionStatus:    user.subscriptionStatus,
      subscriptionPlan:      user.subscriptionPlan,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/payments/create-subscription
 * Creates a recurring subscription via the active provider.
 * Requires provider plan IDs configured in env (e.g. RAZORPAY_PLAN_ID_ANNUAL).
 */
router.post('/create-subscription', requireAuth, async (req, res, next) => {
  try {
    const { plan } = req.body
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' })

    const { adapter, config } = await getActiveProvider()

    const planEnvKey = `${config.activeProvider.toUpperCase()}_PLAN_ID_${plan.toUpperCase()}`
    const planId = process.env[planEnvKey]
    if (!planId) {
      return res.status(501).json({ error: `Recurring billing not configured for this plan (missing ${planEnvKey})` })
    }

    const subscription = await adapter.createSubscription({
      planId,
      totalCount: plan === 'monthly' ? 12 : 1,
      notes:      { userId: req.user._id.toString(), plan },
    })

    res.json({
      subscriptionId: subscription.id,
      plan,
      keyId: adapter.publicKey,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/payments/webhook
 * Provider calls this for async payment events. Signature is verified via the
 * active provider adapter before any state is changed.
 */
router.post('/webhook', async (req, res, next) => {
  try {
    const { adapter } = await getActiveProvider()

    const signatureValid = adapter.verifyWebhookSignature({
      body:      req.body,  // raw Buffer — server.js keeps this route unparsed
      signature: req.headers['x-razorpay-signature'],
    })
    if (!signatureValid) {
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const event = JSON.parse(req.body.toString())

    switch (event.event) {
      case 'payment.captured': {
        // Idempotent — /verify may have already activated the user
        const { userId, plan } = event.payload.payment.entity.notes || {}
        if (!userId || !PLANS[plan]) break
        const user = await User.findById(userId)
        if (user && user.subscriptionStatus !== 'active') {
          await User.findByIdAndUpdate(userId, {
            $set: {
              subscriptionStatus:    'active',
              subscriptionPlan:      plan,
              subscriptionStartedAt: new Date(),
              subscriptionExpiresAt: planExpiresAt(plan),
              graceEndsAt:           null,
            },
          })
        }
        break
      }

      case 'subscription.charged': {
        const entity = event.payload.subscription.entity
        const { userId, plan } = entity.notes || {}
        if (!userId || !PLANS[plan]) break
        await User.findByIdAndUpdate(userId, {
          $set: {
            subscriptionStatus:     'active',
            subscriptionPlan:       plan,
            subscriptionExpiresAt:  planExpiresAt(plan),
            razorpaySubscriptionId: entity.id,
            graceEndsAt:            null,
          },
        })
        break
      }

      case 'subscription.halted': {
        // Payment failed — 3-day grace period before access is removed
        const entity = event.payload.subscription.entity
        const { userId } = entity.notes || {}
        if (!userId) break
        await User.findByIdAndUpdate(userId, {
          $set: {
            subscriptionStatus: 'grace',
            graceEndsAt:        new Date(Date.now() + GRACE_DAYS * 86_400_000),
          },
        })
        break
      }

      case 'subscription.cancelled':
      case 'subscription.completed': {
        const entity = event.payload.subscription.entity
        const { userId } = entity.notes || {}
        if (!userId) break
        await User.findByIdAndUpdate(userId, {
          $set: {
            subscriptionStatus:     'lapsed',
            subscriptionExpiresAt:  null,
            graceEndsAt:            null,
            razorpaySubscriptionId: null,
          },
        })
        break
      }

      default:
        break
    }

    res.json({ received: true })
  } catch (err) {
    next(err)
  }
})

export default router

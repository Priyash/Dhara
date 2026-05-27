import { Router } from 'express'
import { User } from '../models/User.js'
import { Transaction } from '../models/Transaction.js'
import { requireAuth } from '../middleware/auth.js'
import { getActiveProvider } from '../providers/index.js'

const router = Router()

const PLANS = {
  monthly: { label: 'Monthly',  amount: 9900,  days: 30  },  // ₹99
  annual:  { label: 'Annual',   amount: 59900, days: 365 },  // ₹599
  family:  { label: 'Family',   amount: 99900, days: 365 },  // ₹999
}

const GRACE_DAYS = 7

function planExpiresAt(plan) {
  return new Date(Date.now() + PLANS[plan].days * 86_400_000)
}

function extendPlanFrom(plan, currentExpiresAt = null) {
  const current = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0
  const now = Date.now()
  const base = Number.isFinite(current) && current > now ? current : now
  return new Date(base + PLANS[plan].days * 86_400_000)
}

/**
 * POST /api/payments/create-order
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

    // Create a pending transaction record immediately
    await Transaction.create({
      userId:    req.user._id,
      userEmail: req.user.email,
      plan,
      amount:    order.amount,
      currency:  order.currency,
      gateway:   'razorpay',
      orderId:   order.orderId,
      status:    'pending',
      planSnapshot: {
        label:  PLANS[plan].label,
        days:   PLANS[plan].days,
        amount: PLANS[plan].amount,
      },
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
 * 4-step backend verification before activating subscription.
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

    // 1. Verify HMAC signature
    const signatureValid = adapter.verifyPaymentSignature({
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })
    if (!signatureValid) {
      await Transaction.findOneAndUpdate(
        { orderId: razorpay_order_id },
        { $set: { status: 'failed', failureReason: 'Invalid HMAC signature', paymentId: razorpay_payment_id } }
      )
      return res.status(400).json({ error: 'Payment verification failed' })
    }

    // 2 & 3. Fetch order and validate status + amount
    const order = await adapter.fetchOrder(razorpay_order_id)
    if (order.status !== 'paid') {
      await Transaction.findOneAndUpdate(
        { orderId: razorpay_order_id },
        { $set: { status: 'failed', failureReason: `Order status: ${order.status}` } }
      )
      return res.status(400).json({ error: 'Order has not been paid' })
    }
    if (order.amount !== PLANS[plan].amount) {
      await Transaction.findOneAndUpdate(
        { orderId: razorpay_order_id },
        { $set: { status: 'failed', failureReason: 'Amount mismatch' } }
      )
      return res.status(400).json({ error: 'Payment amount does not match selected plan' })
    }

    // 4. Ensure the order belongs to this user
    if (order.notes?.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Order does not belong to this account' })
    }

    // Atomic idempotency guard: only one concurrent request wins this update.
    // If status is already 'paid', the update matches nothing and returns null.
    const prevTx = await Transaction.findOneAndUpdate(
      { orderId: razorpay_order_id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', paymentId: razorpay_payment_id } },
      { new: false }
    )

    if (!prevTx) {
      // Either already paid, or transaction doesn't exist (webhook may have beaten us)
      const userFresh = await User.findById(req.user._id)
      return res.json({
        success:               true,
        alreadyProcessed:      true,
        isSubscribed:          userFresh?.isSubscriptionActive ?? req.user.isSubscriptionActive,
        subscriptionStatus:    userFresh?.subscriptionStatus    ?? req.user.subscriptionStatus,
        subscriptionPlan:      userFresh?.subscriptionPlan      ?? req.user.subscriptionPlan,
        subscriptionExpiresAt: userFresh?.subscriptionExpiresAt ?? req.user.subscriptionExpiresAt,
      })
    }

    const currentUser = await User.findById(req.user._id).select('subscriptionExpiresAt').lean()
    const expiresAt = extendPlanFrom(plan, currentUser?.subscriptionExpiresAt)

    // Activate subscription
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          subscriptionStatus:    'active',
          subscriptionPlan:      plan,
          subscriptionStartedAt: new Date(),
          subscriptionExpiresAt: expiresAt,
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
 * POST /api/payments/verify-subscription
 * Verifies HMAC from Razorpay subscription checkout and activates the user.
 */
router.post('/verify-subscription', requireAuth, async (req, res, next) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, plan } = req.body
    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature || !plan) {
      return res.status(400).json({ error: 'Missing required subscription fields' })
    }
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' })

    const { adapter } = await getActiveProvider()

    const signatureValid = adapter.verifySubscriptionSignature({
      paymentId:      razorpay_payment_id,
      subscriptionId: razorpay_subscription_id,
      signature:      razorpay_signature,
    })
    if (!signatureValid) {
      return res.status(400).json({ error: 'Subscription verification failed' })
    }

    const expiresAt = extendPlanFrom(plan)

    // Atomic upsert — $setOnInsert ensures only the first concurrent call writes.
    // If paymentId already exists the unique partial index rejects duplicates, and
    // the upsert returns the existing doc via {new:false} → we detect alreadyProcessed.
    const txResult = await Transaction.findOneAndUpdate(
      { paymentId: razorpay_payment_id },
      {
        $setOnInsert: {
          userId:         req.user._id,
          userEmail:      req.user.email,
          plan,
          amount:         PLANS[plan].amount,
          currency:       'INR',
          gateway:        'razorpay',
          orderId:        `sub_init_${razorpay_subscription_id}`,
          paymentId:      razorpay_payment_id,
          subscriptionId: razorpay_subscription_id,
          status:         'paid',
          planSnapshot: {
            label:  PLANS[plan].label,
            days:   PLANS[plan].days,
            amount: PLANS[plan].amount,
          },
        },
      },
      { upsert: true, new: false }
    )

    if (txResult !== null) {
      // Document already existed — this is a duplicate call
      const userFresh = await User.findById(req.user._id)
      return res.json({
        success:               true,
        alreadyProcessed:      true,
        isSubscribed:          userFresh?.isSubscriptionActive ?? req.user.isSubscriptionActive,
        subscriptionStatus:    userFresh?.subscriptionStatus    ?? req.user.subscriptionStatus,
        subscriptionPlan:      userFresh?.subscriptionPlan      ?? req.user.subscriptionPlan,
        subscriptionExpiresAt: userFresh?.subscriptionExpiresAt ?? req.user.subscriptionExpiresAt,
      })
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          subscriptionStatus:     'active',
          subscriptionPlan:       plan,
          subscriptionStartedAt:  new Date(),
          subscriptionExpiresAt:  expiresAt,
          razorpaySubscriptionId: razorpay_subscription_id,
          graceEndsAt:            null,
          trialEndsAt:            null,
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
 * Recurring billing via provider plan IDs.
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
 * Raw body — verified via HMAC before any state changes.
 */
router.post('/webhook', async (req, res, next) => {
  try {
    const { adapter } = await getActiveProvider()

    const signatureValid = adapter.verifyWebhookSignature({
      body:      req.body,
      signature: req.headers['x-razorpay-signature'],
    })
    if (!signatureValid) {
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const event = JSON.parse(req.body.toString())

    switch (event.event) {
      case 'payment.captured': {
        const entity = event.payload.payment.entity
        const { userId, plan } = entity.notes || {}
        if (!userId || !PLANS[plan]) {
          console.warn('[webhook] payment.captured skipped: missing userId or invalid plan', { userId, plan, orderId: entity.order_id })
          break
        }
        const user = await User.findById(userId)
        if (!user) {
          console.warn('[webhook] payment.captured skipped: user not found', { userId })
          break
        }

        const existingTx = await Transaction.findOne({ orderId: entity.order_id })
          .select('status')
          .lean()

        // Upsert transaction from webhook (in case /verify wasn't called)
        await Transaction.findOneAndUpdate(
          { orderId: entity.order_id },
          {
            $setOnInsert: {
              userId:    user._id,
              userEmail: user.email,
              plan,
              amount:    entity.amount,
              currency:  entity.currency || 'INR',
              gateway:   'razorpay',
              orderId:   entity.order_id,
              planSnapshot: {
                label:  PLANS[plan].label,
                days:   PLANS[plan].days,
                amount: PLANS[plan].amount,
              },
            },
            $set: {
              status:    'paid',
              paymentId: entity.id,
            },
          },
          { upsert: true }
        )

        if (existingTx?.status !== 'paid') {
          await User.findByIdAndUpdate(userId, {
            $set: {
              subscriptionStatus:    'active',
              subscriptionPlan:      plan,
              subscriptionStartedAt: new Date(),
              subscriptionExpiresAt: extendPlanFrom(plan, user.subscriptionExpiresAt),
              graceEndsAt:           null,
            },
          })
        }
        break
      }

      case 'subscription.charged': {
        const entity    = event.payload.subscription.entity
        const paymentId = event.payload.payment?.entity?.id
        const { userId, plan } = entity.notes || {}
        if (!userId || !PLANS[plan]) {
          console.warn('[webhook] subscription.charged skipped: missing userId or invalid plan', { userId, plan, subscriptionId: entity.id })
          break
        }
        if (paymentId && await Transaction.exists({ paymentId })) break

        const user = await User.findById(userId)
        if (!user) {
          console.warn('[webhook] subscription.charged skipped: user not found', { userId })
          break
        }

        const expiresAt = extendPlanFrom(plan, user.subscriptionExpiresAt)

        await Transaction.create({
          userId:    user._id,
          userEmail: user.email,
          plan,
          amount:    PLANS[plan].amount,
          currency:  'INR',
          gateway:   'razorpay',
          orderId:   `sub_renewal_${entity.id}_${Date.now()}`,
          paymentId: event.payload.payment?.entity?.id || null,
          subscriptionId: entity.id,
          status:    'paid',
          planSnapshot: {
            label:  PLANS[plan].label,
            days:   PLANS[plan].days,
            amount: PLANS[plan].amount,
          },
        })

        await User.findByIdAndUpdate(userId, {
          $set: {
            subscriptionStatus:     'active',
            subscriptionPlan:       plan,
            subscriptionExpiresAt:  expiresAt,
            razorpaySubscriptionId: entity.id,
            graceEndsAt:            null,
          },
        })
        break
      }

      case 'subscription.halted': {
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

/**
 * POST /api/payments/cancel
 * Cancels the current user's active subscription immediately.
 * Attempts to cancel the recurring plan at Razorpay if one exists,
 * then marks the user as lapsed regardless of provider outcome.
 */
router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    const { subscriptionStatus, razorpaySubscriptionId } = req.user
    if (!['trial', 'active', 'grace'].includes(subscriptionStatus)) {
      return res.status(400).json({ error: 'No active subscription to cancel' })
    }

    // Best-effort provider cancellation — don't block on failure
    if (razorpaySubscriptionId) {
      try {
        const { adapter } = await getActiveProvider()
        await adapter.cancelSubscription(razorpaySubscriptionId)
      } catch (err) {
        console.error('[cancel] provider cancel failed:', err.message)
      }
    }

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        subscriptionStatus:     'lapsed',
        subscriptionExpiresAt:  null,
        graceEndsAt:            null,
        trialEndsAt:            null,
        razorpaySubscriptionId: null,
      },
    })

    res.json({ success: true, subscriptionStatus: 'lapsed' })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/payments/history
 * Returns the authenticated user's own transaction history.
 */
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const transactions = await Transaction.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

    res.json(transactions.map((t) => ({
      id:         t._id,
      plan:       t.plan,
      planLabel:  t.planSnapshot?.label || t.plan,
      amount:     t.amount,
      currency:   t.currency,
      status:     t.status,
      orderId:    t.orderId,
      paymentId:  t.paymentId,
      date:       t.createdAt,
    })))
  } catch (err) {
    next(err)
  }
})

export default router

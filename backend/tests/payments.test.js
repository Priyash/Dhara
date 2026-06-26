/**
 * Payment flow unit tests — no DB, no Firebase, no Razorpay calls.
 * Tests the critical logic: HMAC verification, subscription state transitions,
 * plan expiry calculation, webhook transitions, cancel flow, and idempotency.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import { validateRazorpaySubscriptionPayment } from '../src/routes/payments.helpers.js'

// ── Helpers mirrored from the production code ─────────────────────────────────

const PLANS = {
  monthly: { label: 'Monthly',  amount: 9900,  days: 30  },
  annual:  { label: 'Annual',   amount: 59900, days: 365 },
  family:  { label: 'Family',   amount: 99900, days: 365 },
}

const GRACE_DAYS = 3

function planExpiresAt(plan) {
  const days = PLANS[plan]?.days
  if (!days) throw new Error(`Unknown plan: ${plan}`)
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

function extendPlanFrom(plan, currentExpiresAt = null) {
  const days = PLANS[plan]?.days
  if (!days) throw new Error(`Unknown plan: ${plan}`)
  const current = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0
  const now = Date.now()
  const base = Number.isFinite(current) && current > now ? current : now
  return new Date(base + days * 86_400_000)
}

function verifyRazorpayHmac(orderId, paymentId, signature, secret) {
  const payload = `${orderId}|${paymentId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

function verifySubscriptionHmac(paymentId, subscriptionId, signature, secret) {
  const payload = `${paymentId}|${subscriptionId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

function isSubscriptionActive(user) {
  const now = new Date()
  switch (user.subscriptionStatus) {
    case 'trial':  return Boolean(user.trialEndsAt  && user.trialEndsAt  > now)
    case 'active': return Boolean(user.subscriptionExpiresAt) && user.subscriptionExpiresAt > now
    case 'grace':  return Boolean(user.graceEndsAt  && user.graceEndsAt  > now)
    default:       return false
  }
}

// Simulates the cancel endpoint state transition
function applyCancelToUser(user) {
  if (!['trial', 'active', 'grace'].includes(user.subscriptionStatus)) {
    throw new Error('No active subscription to cancel')
  }
  return {
    ...user,
    subscriptionStatus:     'lapsed',
    subscriptionExpiresAt:  null,
    graceEndsAt:            null,
    trialEndsAt:            null,
    razorpaySubscriptionId: null,
  }
}

// Simulates webhook state transitions
function applyWebhookEvent(eventType, user, extra = {}) {
  switch (eventType) {
    case 'subscription.halted':
      return {
        ...user,
        subscriptionStatus: 'grace',
        graceEndsAt: new Date(Date.now() + GRACE_DAYS * 86_400_000),
      }
    case 'subscription.cancelled':
    case 'subscription.completed':
      return {
        ...user,
        subscriptionStatus:     'lapsed',
        subscriptionExpiresAt:  null,
        graceEndsAt:            null,
        razorpaySubscriptionId: null,
      }
    case 'subscription.charged':
      return {
        ...user,
        subscriptionStatus:    'active',
        subscriptionExpiresAt: extendPlanFrom(extra.plan, user.subscriptionExpiresAt),
        graceEndsAt:           null,
      }
    default:
      return user
  }
}

// ── HMAC verification ─────────────────────────────────────────────────────────

describe('Razorpay HMAC verification', () => {
  const secret = 'test_webhook_secret'

  it('accepts a correctly signed payment', () => {
    const orderId   = 'order_abc123'
    const paymentId = 'pay_xyz789'
    const sig = crypto.createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex')
    assert.equal(verifyRazorpayHmac(orderId, paymentId, sig, secret), true)
  })

  it('rejects a tampered signature', () => {
    assert.equal(
      verifyRazorpayHmac('order_abc123', 'pay_xyz789', 'tampered_signature', secret),
      false
    )
  })

  it('rejects when orderId is swapped', () => {
    const sig = crypto.createHmac('sha256', secret)
      .update('order_WRONG|pay_xyz789')
      .digest('hex')
    assert.equal(
      verifyRazorpayHmac('order_abc123', 'pay_xyz789', sig, secret),
      false
    )
  })
})

// ── Plan expiry calculation ───────────────────────────────────────────────────

describe('planExpiresAt', () => {
  it('monthly plan expires in ~30 days', () => {
    const exp = planExpiresAt('monthly')
    const daysFromNow = (exp - Date.now()) / (1000 * 60 * 60 * 24)
    assert.ok(daysFromNow >= 29.9 && daysFromNow <= 30.1, `expected ~30 days, got ${daysFromNow.toFixed(2)}`)
  })

  it('annual plan expires in ~365 days', () => {
    const exp = planExpiresAt('annual')
    const daysFromNow = (exp - Date.now()) / (1000 * 60 * 60 * 24)
    assert.ok(daysFromNow >= 364.9 && daysFromNow <= 365.1)
  })

  it('throws on unknown plan', () => {
    assert.throws(() => planExpiresAt('weekly'), /Unknown plan/)
  })
})

// ── Subscription active check ─────────────────────────────────────────────────

describe('isSubscriptionActive', () => {
  const future = new Date(Date.now() + 30 * 86_400_000)
  const past   = new Date(Date.now() - 1_000)

  it('active with future expiry → true', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'active', subscriptionExpiresAt: future }), true)
  })

  it('active with past expiry → false', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'active', subscriptionExpiresAt: past }), false)
  })

  it('active with no expiry date → false (null expiry must not grant access)', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'active', subscriptionExpiresAt: null }), false)
  })

  it('trial within window → true', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'trial', trialEndsAt: future }), true)
  })

  it('trial past window → false', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'trial', trialEndsAt: past }), false)
  })

  it('grace within window → true', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'grace', graceEndsAt: future }), true)
  })

  it('grace past window → false', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'grace', graceEndsAt: past }), false)
  })

  it('free → false', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'free' }), false)
  })

  it('lapsed → false', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'lapsed' }), false)
  })
})

// ── Content gating logic ──────────────────────────────────────────────────────

describe('Content access gating', () => {
  function canWatch(content, user) {
    if (!user) return false                         // unauthenticated
    if (!user.emailVerified) return false           // unverified
    if (!content.isPremium) return true             // free content, any user
    return isSubscriptionActive(user)               // premium: need active sub
  }

  const freeContent    = { isPremium: false }
  const premiumContent = { isPremium: true  }
  const activeUser     = { emailVerified: true, subscriptionStatus: 'active', subscriptionExpiresAt: new Date(Date.now() + 86_400_000) }
  const freeUser       = { emailVerified: true, subscriptionStatus: 'free' }
  const unverifiedUser = { emailVerified: false, subscriptionStatus: 'active', subscriptionExpiresAt: new Date(Date.now() + 86_400_000) }

  it('unauthenticated user cannot watch anything', () => {
    assert.equal(canWatch(freeContent,    null), false)
    assert.equal(canWatch(premiumContent, null), false)
  })

  it('unverified user cannot watch even free content', () => {
    assert.equal(canWatch(freeContent, unverifiedUser), false)
  })

  it('free user can watch free content', () => {
    assert.equal(canWatch(freeContent, freeUser), true)
  })

  it('free user cannot watch premium content', () => {
    assert.equal(canWatch(premiumContent, freeUser), false)
  })

  it('subscribed user can watch premium content', () => {
    assert.equal(canWatch(premiumContent, activeUser), true)
  })

  it('subscribed user can watch free content', () => {
    assert.equal(canWatch(freeContent, activeUser), true)
  })
})

// ── Subscription HMAC verification ───────────────────────────────────────────

describe('Razorpay subscription HMAC verification', () => {
  const secret = 'test_key_secret'

  it('accepts a correctly signed subscription payment', () => {
    const paymentId      = 'pay_abc123'
    const subscriptionId = 'sub_xyz789'
    const sig = crypto.createHmac('sha256', secret)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex')
    assert.equal(verifySubscriptionHmac(paymentId, subscriptionId, sig, secret), true)
  })

  it('rejects a tampered signature', () => {
    assert.equal(
      verifySubscriptionHmac('pay_abc123', 'sub_xyz789', 'bad_sig', secret),
      false
    )
  })

  it('rejects when payment_id and subscription_id are swapped', () => {
    const sig = crypto.createHmac('sha256', secret)
      .update('sub_xyz789|pay_abc123')  // wrong order
      .digest('hex')
    assert.equal(
      verifySubscriptionHmac('pay_abc123', 'sub_xyz789', sig, secret),
      false
    )
  })

  it('differs from one-time order signature (different payload format)', () => {
    const secret2  = 'same_secret'
    const orderId  = 'order_abc'
    const payId    = 'pay_abc'
    const subId    = 'sub_abc'
    const orderSig = crypto.createHmac('sha256', secret2).update(`${orderId}|${payId}`).digest('hex')
    const subSig   = crypto.createHmac('sha256', secret2).update(`${payId}|${subId}`).digest('hex')
    assert.notEqual(orderSig, subSig)
  })
})

// ── Subscription provider object validation ──────────────────────────────────

describe('Razorpay subscription provider validation', () => {
  const base = {
    expectedPlan:           'monthly',
    expectedPlanId:         'plan_monthly',
    expectedUserId:         'user_123',
    expectedSubscriptionId: 'sub_123',
    expectedPaymentId:      'pay_123',
  }

  function validObjects(overrides = {}) {
    return {
      subscription: {
        id:      'sub_123',
        status:  'active',
        plan_id: 'plan_monthly',
        notes:   { userId: 'user_123', plan: 'monthly' },
        ...(overrides.subscription || {}),
      },
      payment: {
        id:              'pay_123',
        status:          'captured',
        subscription_id: 'sub_123',
        amount:          PLANS.monthly.amount,
        currency:        'INR',
        ...(overrides.payment || {}),
      },
    }
  }

  it('accepts matching subscription and payment objects', () => {
    assert.doesNotThrow(() => {
      validateRazorpaySubscriptionPayment({ ...base, ...validObjects() })
    })
  })

  it('rejects when Razorpay notes plan differs from expected plan', () => {
    assert.throws(() => {
      validateRazorpaySubscriptionPayment({
        ...base,
        ...validObjects({ subscription: { notes: { userId: 'user_123', plan: 'annual' } } }),
      })
    }, /plan does not match/)
  })

  it('rejects when Razorpay notes user differs from the authenticated user', () => {
    assert.throws(() => {
      validateRazorpaySubscriptionPayment({
        ...base,
        ...validObjects({ subscription: { notes: { userId: 'user_456', plan: 'monthly' } } }),
      })
    }, /does not belong/)
  })

  it('rejects when provider plan_id is not the configured plan id', () => {
    assert.throws(() => {
      validateRazorpaySubscriptionPayment({
        ...base,
        ...validObjects({ subscription: { plan_id: 'plan_family' } }),
      })
    }, /provider plan/)
  })

  it('rejects when payment amount does not match the expected plan amount', () => {
    assert.throws(() => {
      validateRazorpaySubscriptionPayment({
        ...base,
        ...validObjects({ payment: { amount: PLANS.annual.amount } }),
      })
    }, /amount/)
  })

  it('rejects when the payment is for a different subscription', () => {
    assert.throws(() => {
      validateRazorpaySubscriptionPayment({
        ...base,
        ...validObjects({ payment: { subscription_id: 'sub_other' } }),
      })
    }, /does not belong to this subscription/)
  })
})

// ── extendPlanFrom (renewal date stacking) ────────────────────────────────────

describe('extendPlanFrom', () => {
  it('extends from now when no existing expiry', () => {
    const result = extendPlanFrom('monthly')
    const daysFromNow = (result.getTime() - Date.now()) / 86_400_000
    assert.ok(daysFromNow >= 29.9 && daysFromNow <= 30.1, `expected ~30 days, got ${daysFromNow.toFixed(2)}`)
  })

  it('extends from an existing future expiry (stacks renewals)', () => {
    const futureExpiry = new Date(Date.now() + 15 * 86_400_000) // 15 days from now
    const result = extendPlanFrom('monthly', futureExpiry)
    const daysFromNow = (result.getTime() - Date.now()) / 86_400_000
    // Should be ~45 days (15 remaining + 30 new)
    assert.ok(daysFromNow >= 44.8 && daysFromNow <= 45.2, `expected ~45 days, got ${daysFromNow.toFixed(2)}`)
  })

  it('extends from now when existing expiry is in the past', () => {
    const pastExpiry = new Date(Date.now() - 5 * 86_400_000) // already expired
    const result = extendPlanFrom('annual', pastExpiry)
    const daysFromNow = (result.getTime() - Date.now()) / 86_400_000
    assert.ok(daysFromNow >= 364.9 && daysFromNow <= 365.1)
  })

  it('annual plan extends by 365 days', () => {
    const result = extendPlanFrom('annual')
    const daysFromNow = (result.getTime() - Date.now()) / 86_400_000
    assert.ok(daysFromNow >= 364.9 && daysFromNow <= 365.1)
  })

  it('throws on unknown plan', () => {
    assert.throws(() => extendPlanFrom('weekly'), /Unknown plan/)
  })
})

// ── Webhook state transitions ─────────────────────────────────────────────────

describe('Webhook event state transitions', () => {
  const activeUser = {
    subscriptionStatus:    'active',
    subscriptionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    graceEndsAt:           null,
    razorpaySubscriptionId: 'sub_existing',
  }

  it('subscription.halted → grace status with 3-day grace window', () => {
    const updated = applyWebhookEvent('subscription.halted', activeUser)
    assert.equal(updated.subscriptionStatus, 'grace')
    assert.ok(updated.graceEndsAt instanceof Date)
    const graceDays = (updated.graceEndsAt.getTime() - Date.now()) / 86_400_000
    assert.ok(graceDays >= 2.9 && graceDays <= 3.1, `expected ~3 grace days, got ${graceDays.toFixed(2)}`)
  })

  it('subscription.cancelled → lapsed, clears expiry and subscriptionId', () => {
    const updated = applyWebhookEvent('subscription.cancelled', activeUser)
    assert.equal(updated.subscriptionStatus, 'lapsed')
    assert.equal(updated.subscriptionExpiresAt, null)
    assert.equal(updated.razorpaySubscriptionId, null)
  })

  it('subscription.completed → lapsed (treated same as cancelled)', () => {
    const updated = applyWebhookEvent('subscription.completed', activeUser)
    assert.equal(updated.subscriptionStatus, 'lapsed')
  })

  it('subscription.charged → active with extended expiry', () => {
    const graceUser = {
      subscriptionStatus:    'grace',
      subscriptionExpiresAt: new Date(Date.now() - 1_000), // just expired
      graceEndsAt:           new Date(Date.now() + 2 * 86_400_000),
    }
    const updated = applyWebhookEvent('subscription.charged', graceUser, { plan: 'monthly' })
    assert.equal(updated.subscriptionStatus, 'active')
    assert.equal(updated.graceEndsAt, null)
    const daysFromNow = (updated.subscriptionExpiresAt.getTime() - Date.now()) / 86_400_000
    assert.ok(daysFromNow >= 29.9 && daysFromNow <= 30.1)
  })

  it('subscription.charged stacks on existing future expiry', () => {
    const userWith15Days = {
      subscriptionStatus:    'active',
      subscriptionExpiresAt: new Date(Date.now() + 15 * 86_400_000),
      graceEndsAt:           null,
    }
    const updated = applyWebhookEvent('subscription.charged', userWith15Days, { plan: 'monthly' })
    const daysFromNow = (updated.subscriptionExpiresAt.getTime() - Date.now()) / 86_400_000
    assert.ok(daysFromNow >= 44.8 && daysFromNow <= 45.2, `expected ~45 days, got ${daysFromNow.toFixed(2)}`)
  })
})

// ── Cancel subscription flow ──────────────────────────────────────────────────

describe('Cancel subscription', () => {
  it('trial user can cancel → lapsed', () => {
    const user = { subscriptionStatus: 'trial', trialEndsAt: new Date(Date.now() + 3 * 86_400_000) }
    const updated = applyCancelToUser(user)
    assert.equal(updated.subscriptionStatus, 'lapsed')
    assert.equal(updated.trialEndsAt, null)
  })

  it('active user can cancel → lapsed, clears all dates', () => {
    const user = {
      subscriptionStatus:     'active',
      subscriptionExpiresAt:  new Date(Date.now() + 30 * 86_400_000),
      razorpaySubscriptionId: 'sub_abc',
    }
    const updated = applyCancelToUser(user)
    assert.equal(updated.subscriptionStatus, 'lapsed')
    assert.equal(updated.subscriptionExpiresAt, null)
    assert.equal(updated.razorpaySubscriptionId, null)
  })

  it('grace user can cancel → lapsed', () => {
    const user = {
      subscriptionStatus: 'grace',
      graceEndsAt:        new Date(Date.now() + 86_400_000),
    }
    const updated = applyCancelToUser(user)
    assert.equal(updated.subscriptionStatus, 'lapsed')
    assert.equal(updated.graceEndsAt, null)
  })

  it('free user cannot cancel (throws)', () => {
    assert.throws(
      () => applyCancelToUser({ subscriptionStatus: 'free' }),
      /No active subscription/
    )
  })

  it('lapsed user cannot cancel again (throws)', () => {
    assert.throws(
      () => applyCancelToUser({ subscriptionStatus: 'lapsed' }),
      /No active subscription/
    )
  })
})

// ── Idempotency guards ────────────────────────────────────────────────────────

describe('Payment idempotency', () => {
  // Simulates what the backend does: skip re-processing if transaction already paid
  function processPaymentIdempotent(existingTxStatus, activateUser) {
    if (existingTxStatus === 'paid') {
      return { skipped: true }
    }
    activateUser()
    return { skipped: false }
  }

  it('does not reactivate subscription when transaction already paid', () => {
    let activationCount = 0
    const result = processPaymentIdempotent('paid', () => { activationCount++ })
    assert.equal(result.skipped, true)
    assert.equal(activationCount, 0)
  })

  it('activates subscription when transaction is new (pending)', () => {
    let activationCount = 0
    const result = processPaymentIdempotent('pending', () => { activationCount++ })
    assert.equal(result.skipped, false)
    assert.equal(activationCount, 1)
  })

  it('activates subscription when no prior transaction exists', () => {
    let activationCount = 0
    const result = processPaymentIdempotent(null, () => { activationCount++ })
    assert.equal(result.skipped, false)
    assert.equal(activationCount, 1)
  })
})

// ── Amount validation ─────────────────────────────────────────────────────────

describe('Payment amount validation', () => {
  function validateAmount(plan, receivedAmount) {
    if (!PLANS[plan]) return { valid: false, reason: 'invalid_plan' }
    if (receivedAmount !== PLANS[plan].amount) return { valid: false, reason: 'amount_mismatch' }
    return { valid: true }
  }

  it('accepts correct amount for monthly plan', () => {
    assert.deepEqual(validateAmount('monthly', 9900), { valid: true })
  })

  it('accepts correct amount for annual plan', () => {
    assert.deepEqual(validateAmount('annual', 59900), { valid: true })
  })

  it('rejects tampered lower amount', () => {
    const result = validateAmount('annual', 9900)  // monthly price for annual plan
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'amount_mismatch')
  })

  it('rejects unknown plan', () => {
    const result = validateAmount('premium', 9900)
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'invalid_plan')
  })
})

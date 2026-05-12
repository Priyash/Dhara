/**
 * Payment flow unit tests — no DB, no Firebase, no Razorpay calls.
 * Tests the critical logic: HMAC verification, subscription state transitions,
 * plan expiry calculation.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'

// ── Helpers mirrored from the production code ─────────────────────────────────

const PLANS = {
  monthly: { label: 'Monthly',  amount: 9900,  days: 30  },
  annual:  { label: 'Annual',   amount: 59900, days: 365 },
  family:  { label: 'Family',   amount: 99900, days: 365 },
}

function planExpiresAt(plan) {
  const days = PLANS[plan]?.days
  if (!days) throw new Error(`Unknown plan: ${plan}`)
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

function verifyRazorpayHmac(orderId, paymentId, signature, secret) {
  const payload = `${orderId}|${paymentId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

function isSubscriptionActive(user) {
  const now = new Date()
  switch (user.subscriptionStatus) {
    case 'trial':  return Boolean(user.trialEndsAt  && user.trialEndsAt  > now)
    case 'active': return !user.subscriptionExpiresAt || user.subscriptionExpiresAt > now
    case 'grace':  return Boolean(user.graceEndsAt  && user.graceEndsAt  > now)
    default:       return false
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

  it('active with no expiry date → true (annual/family perpetual-style)', () => {
    assert.equal(isSubscriptionActive({ subscriptionStatus: 'active', subscriptionExpiresAt: null }), true)
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

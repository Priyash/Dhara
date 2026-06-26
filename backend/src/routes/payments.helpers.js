export const GRACE_DAYS = 7

export const PLANS = {
  monthly: { label: 'Monthly',  amount: 9900,  days: 30  },  // ₹99
  annual:  { label: 'Annual',   amount: 59900, days: 365 },  // ₹599
  family:  { label: 'Family',   amount: 99900, days: 365 },  // ₹999
}

export function extendPlanFrom(plan, currentExpiresAt = null) {
  const current = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0
  const now = Date.now()
  const base = Number.isFinite(current) && current > now ? current : now
  return new Date(base + PLANS[plan].days * 86_400_000)
}

export function planEnvKey(provider, plan) {
  return `${provider.toUpperCase()}_PLAN_ID_${plan.toUpperCase()}`
}

export function getExpectedProviderPlanId(provider, plan) {
  return process.env[planEnvKey(provider, plan)] || ''
}

function failSubscriptionVerification(message, status = 400) {
  return Object.assign(new Error(message), { status, code: 'SUBSCRIPTION_VERIFICATION_FAILED' })
}

export function validateRazorpaySubscriptionPayment({
  subscription,
  payment,
  expectedPlan,
  expectedPlanId,
  expectedUserId,
  expectedSubscriptionId,
  expectedPaymentId,
}) {
  if (!subscription || subscription.id !== expectedSubscriptionId) {
    throw failSubscriptionVerification('Subscription verification failed')
  }
  if (!payment || payment.id !== expectedPaymentId) {
    throw failSubscriptionVerification('Subscription payment verification failed')
  }
  if (payment.subscription_id !== expectedSubscriptionId) {
    throw failSubscriptionVerification('Payment does not belong to this subscription')
  }
  if (subscription.notes?.userId !== expectedUserId) {
    throw failSubscriptionVerification('Subscription does not belong to this account', 403)
  }
  if (subscription.notes?.plan !== expectedPlan) {
    throw failSubscriptionVerification('Subscription plan does not match checkout plan')
  }
  if (subscription.plan_id !== expectedPlanId) {
    throw failSubscriptionVerification('Subscription provider plan does not match selected plan')
  }
  if (payment.amount !== PLANS[expectedPlan].amount) {
    throw failSubscriptionVerification('Subscription payment amount does not match selected plan')
  }
  if ((payment.currency || '').toUpperCase() !== 'INR') {
    throw failSubscriptionVerification('Subscription payment currency is invalid')
  }
  if (payment.status !== 'captured') {
    throw failSubscriptionVerification('Subscription payment has not been captured')
  }
  if (!['active', 'authenticated'].includes(subscription.status)) {
    throw failSubscriptionVerification(`Subscription status is ${subscription.status || 'unknown'}`)
  }
}

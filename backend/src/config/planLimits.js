/**
 * Per-plan feature limits.
 * Single source of truth — imported by the stream endpoint and any future
 * enforcement points (e.g. download limits, audio quality).
 */
export const PLAN_LIMITS = {
  monthly: { maxStreams: 1, maxQualityHeight: 720  },
  annual:  { maxStreams: 2, maxQualityHeight: 1080 },
  family:  { maxStreams: 4, maxQualityHeight: null }, // null = no cap
  trial:   { maxStreams: 1, maxQualityHeight: 720  },
}

export function getPlanLimits(user) {
  if (!user?.isSubscriptionActive) return null
  const key = user.subscriptionStatus === 'trial' ? 'trial' : (user.subscriptionPlan ?? 'monthly')
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.monthly
}

/**
 * Per-plan feature limits.
 * Single source of truth — imported by the stream endpoint and any future
 * enforcement points (e.g. download limits, audio quality).
 *
 * maxQualityHeight: HLS level cap sent to the client player (null = unlimited).
 * maxStreams:       maximum concurrent active stream sessions.
 */
export const PLAN_LIMITS = {
  free:    { maxStreams: 1, maxQualityHeight: 480  },
  trial:   { maxStreams: 1, maxQualityHeight: 720  },
  monthly: { maxStreams: 1, maxQualityHeight: 720  },
  annual:  { maxStreams: 2, maxQualityHeight: 1080 },
  family:  { maxStreams: 4, maxQualityHeight: null }, // null = no cap (4K)
}

/** Returns the limits object for the given user (never null). */
export function getPlanLimits(user) {
  const key = getPlanTier(user)
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.free
}

/** Returns a stable string key for the user's current tier. */
export function getPlanTier(user) {
  if (!user?.isSubscriptionActive) return 'free'
  if (user.subscriptionStatus === 'trial') return 'trial'
  return user.subscriptionPlan ?? 'monthly'
}

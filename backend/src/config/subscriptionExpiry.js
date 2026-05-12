/**
 * subscriptionExpiry.js
 *
 * Runs once at startup, then on a daily interval.
 * Transitions expired subscriptions through the state machine:
 *
 *   active  → grace   (subscriptionExpiresAt has passed)
 *   trial   → free    (trialEndsAt has passed)
 *   grace   → lapsed  (graceEndsAt has passed)
 *
 * Without this, a user whose subscription expired at 2am would keep their
 * active status until they next make an authenticated request.
 */

import { User } from '../models/User.js'

const INTERVAL_MS = 6 * 60 * 60 * 1000  // run every 6 hours

async function runExpiryCheck() {
  const now = new Date()
  try {
    // active → grace: subscription window closed
    const toGrace = await User.updateMany(
      { subscriptionStatus: 'active', subscriptionExpiresAt: { $lt: now } },
      { $set: { subscriptionStatus: 'grace', graceEndsAt: new Date(now.getTime() + 7 * 86_400_000) } }
    )

    // trial → free: trial window closed
    const trialExpired = await User.updateMany(
      { subscriptionStatus: 'trial', trialEndsAt: { $lt: now } },
      { $set: { subscriptionStatus: 'free', trialEndsAt: null } }
    )

    // grace → lapsed: grace period closed
    const toLapsed = await User.updateMany(
      { subscriptionStatus: 'grace', graceEndsAt: { $lt: now } },
      { $set: { subscriptionStatus: 'lapsed', graceEndsAt: null } }
    )

    const total = toGrace.modifiedCount + trialExpired.modifiedCount + toLapsed.modifiedCount
    if (total > 0) {
      console.log(`[expiry] ${toGrace.modifiedCount} → grace, ${trialExpired.modifiedCount} trial expired, ${toLapsed.modifiedCount} → lapsed`)
    }
  } catch (err) {
    console.error('[expiry] check failed:', err.message)
  }
}

export function startSubscriptionExpiryJob() {
  // Run immediately on startup to catch anything that expired during downtime
  runExpiryCheck()
  // Then every 6 hours
  const timer = setInterval(runExpiryCheck, INTERVAL_MS)
  // Don't keep the process alive just for this timer
  timer.unref()
}

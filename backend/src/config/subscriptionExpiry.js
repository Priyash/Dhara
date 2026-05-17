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
import { emailSubscriptionRenewalReminder } from './email.js'

const INTERVAL_MS        = 6 * 60 * 60 * 1000   // run every 6 hours
const REMINDER_WINDOW_MS = 3  * 86_400_000       // send reminder 3 days before expiry
const REMINDER_COOLDOWN  = 2  * 86_400_000       // don't re-send within 2 days

async function runRenewalReminders() {
  try {
    const now         = new Date()
    const windowStart = now
    const windowEnd   = new Date(now.getTime() + REMINDER_WINDOW_MS)
    const cooloffCut  = new Date(now.getTime() - REMINDER_COOLDOWN)

    // Find active subscribers expiring in the next 3 days who haven't been reminded recently
    const users = await User.find({
      subscriptionStatus:     'active',
      subscriptionExpiresAt:  { $gte: windowStart, $lte: windowEnd },
      $or: [
        { renewalReminderSentAt: null },
        { renewalReminderSentAt: { $lt: cooloffCut } },
      ],
    }).select('displayName email subscriptionExpiresAt subscriptionPlan renewalReminderSentAt').lean()

    for (const user of users) {
      emailSubscriptionRenewalReminder(
        user.displayName || user.email,
        user.email,
        user.subscriptionExpiresAt,
        user.subscriptionPlan || 'subscription'
      ).catch((err) => console.error('[email] renewal-reminder failed:', err.message))

      await User.findByIdAndUpdate(user._id, { $set: { renewalReminderSentAt: now } })
    }

    if (users.length > 0) {
      console.log(`[renewal-reminder] sent to ${users.length} user(s)`)
    }
  } catch (err) {
    console.error('[renewal-reminder] failed:', err.message)
  }
}

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

    // Send renewal reminders in the same pass
    await runRenewalReminders()
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

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
import { withJobLock } from './jobLock.js'

const INTERVAL_MS        = 6 * 60 * 60 * 1000   // run every 6 hours
const REMINDER_WINDOW_MS = 3  * 86_400_000       // send reminder 3 days before expiry
const REMINDER_COOLDOWN  = 2  * 86_400_000       // don't re-send within 2 days
const LOCK_TTL_MS        = 30 * 60 * 1000        // covers a slow run; auto-expires if an instance crashes mid-job
const REMINDER_BATCH     = 100                   // users per DB page — prevents loading all into RAM at once
const EMAIL_DELAY_MS     = 1_000                 // 1 email/sec max — stays within Resend rate limits at scale

async function runRenewalReminders() {
  try {
    const now         = new Date()
    const windowStart = now
    const windowEnd   = new Date(now.getTime() + REMINDER_WINDOW_MS)
    const cooloffCut  = new Date(now.getTime() - REMINDER_COOLDOWN)

    const baseFilter = {
      subscriptionStatus:     'active',
      subscriptionExpiresAt:  { $gte: windowStart, $lte: windowEnd },
      $or: [
        { renewalReminderSentAt: null },
        { renewalReminderSentAt: { $lt: cooloffCut } },
      ],
    }

    let sent = 0
    let lastId = null

    // Cursor-based pagination — avoids loading all matching users into RAM at once.
    // At 500K users, even with 5K expiring on the same day, this processes 100 at a time.
    while (true) {
      const filter = lastId ? { ...baseFilter, _id: { $gt: lastId } } : baseFilter
      const users = await User.find(filter)
        .select('displayName email subscriptionExpiresAt subscriptionPlan renewalReminderSentAt')
        .sort({ _id: 1 })
        .limit(REMINDER_BATCH)
        .lean()

      if (!users.length) break
      lastId = users[users.length - 1]._id

      for (const user of users) {
        try {
          await emailSubscriptionRenewalReminder(
            user.displayName || user.email,
            user.email,
            user.subscriptionExpiresAt,
            user.subscriptionPlan || 'subscription'
          )
          await User.findByIdAndUpdate(user._id, { $set: { renewalReminderSentAt: now } })
          sent++
          // Rate-limit email sends to avoid exceeding Resend's per-second limit
          await new Promise(r => setTimeout(r, EMAIL_DELAY_MS))
        } catch (err) {
          console.error('[email] renewal-reminder failed for', user.email, '—', err.message)
        }
      }
    }

    if (sent > 0) {
      console.log(`[renewal-reminder] sent to ${sent} user(s)`)
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

function runExpiryCheckLocked() {
  // Only one instance should run this at a time — otherwise N instances all
  // send the same renewal reminder emails to the same users every 6 hours.
  return withJobLock('subscription-expiry', LOCK_TTL_MS, runExpiryCheck)
    .catch((err) => console.error('[expiry] lock acquisition failed:', err.message))
}

export function startSubscriptionExpiryJob() {
  // Run immediately on startup to catch anything that expired during downtime
  runExpiryCheckLocked()
  // Then every 6 hours
  const timer = setInterval(runExpiryCheckLocked, INTERVAL_MS)
  // Don't keep the process alive just for this timer
  timer.unref()
}

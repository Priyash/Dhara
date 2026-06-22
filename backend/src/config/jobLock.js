import { JobLock } from '../models/JobLock.js'

/**
 * Best-effort distributed lock for scheduled jobs (subscription expiry,
 * earnings calculation). Each backend instance runs its own setInterval/
 * setTimeout scheduler with no coordination, so without this, deploying
 * more than one instance makes every job run once per instance — duplicate
 * reminder emails, redundant aggregation work, etc.
 *
 * Lock acquisition is a single atomic findOneAndUpdate against an expired
 * (or missing) lock document; losing the race falls through to an insert
 * that fails on the unique `key` index, which we read as "another instance
 * holds it." The lock expires after ttlMs regardless of whether the holder
 * releases it, so a crashed instance can't wedge the job forever.
 *
 * Returns true if `fn` ran (this instance acquired the lock), false if
 * another instance currently holds it.
 */
export async function withJobLock(key, ttlMs, fn) {
  const now       = new Date()
  const expiresAt = new Date(now.getTime() + ttlMs)

  try {
    const stoleExpired = await JobLock.findOneAndUpdate(
      { key, expiresAt: { $lte: now } },
      { $set: { expiresAt, lockedAt: now } },
      { new: true }
    )
    if (!stoleExpired) {
      await JobLock.create({ key, lockedAt: now, expiresAt })
    }
  } catch (err) {
    if (err.code === 11000) return false   // another instance holds the lock
    throw err
  }

  await fn()
  return true
}

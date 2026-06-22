/**
 * earningsJob.js
 *
 * Automatically calculates creator earnings on the 1st of each month.
 *
 * Logic (mirrors POST /api/admin/revenue/calculate):
 *   For each approved creator content piece:
 *     monthlyViews = viewCount − viewCountSnapshot
 *     grossPaise   = monthlyViews × RATE_PER_VIEW_PAISE
 *     netPaise     = grossPaise × (tierShare / 100)
 *   Creates a CreatorEarning record and advances viewCountSnapshot.
 *   Idempotent — skips content already calculated for that period.
 *
 * The job also runs once on startup to catch any missed month-end calculation
 * (e.g. if the server was down on the 1st).
 */

import { Content }        from '../models/Content.js'
import { CreatorEarning } from '../models/CreatorEarning.js'
import { withJobLock }    from './jobLock.js'

const RATE_PER_VIEW_PAISE = 50   // ₹0.50 per view — matches admin default
const LOCK_TTL_MS         = 30 * 60 * 1000   // covers a slow run; auto-expires if an instance crashes mid-job

const TIERS = [
  { name: 'Newcomer',    maxViews: 999,      share: 60 },
  { name: 'Rising Star', maxViews: 9_999,    share: 65 },
  { name: 'Established', maxViews: 99_999,   share: 70 },
  { name: 'Featured',    maxViews: Infinity,  share: 75 },
]

function tierFor(totalViews) {
  return TIERS.find((t) => totalViews <= t.maxViews) ?? TIERS[TIERS.length - 1]
}

export async function calculateMonthlyEarnings(month, year, ratePerViewPaise = RATE_PER_VIEW_PAISE) {
  const pieces = await Content
    .find({ submissionStatus: 'approved', creatorId: { $ne: null } })
    .select('_id creatorId viewCount viewCountSnapshot')
    .lean()

  // Aggregate total views per creator for tier calculation
  const creatorTotals = new Map()
  for (const p of pieces) {
    const cid = String(p.creatorId)
    creatorTotals.set(cid, (creatorTotals.get(cid) ?? 0) + (p.viewCount ?? 0))
  }

  // Batch idempotency check — one query instead of N serial round-trips
  const allIds = pieces.map((p) => p._id)
  const alreadyDone = new Set(
    (await CreatorEarning.find({ year, month, contentId: { $in: allIds } })
      .select('contentId')
      .lean()
    ).map((e) => String(e.contentId))
  )

  let created = 0, skipped = 0
  const ops = []

  for (const piece of pieces) {
    const monthlyViews = (piece.viewCount ?? 0) - (piece.viewCountSnapshot ?? 0)
    if (monthlyViews <= 0) { skipped++; continue }

    if (alreadyDone.has(String(piece._id))) { skipped++; continue }

    const tier       = tierFor(creatorTotals.get(String(piece.creatorId)) ?? 0)
    const grossPaise = monthlyViews * ratePerViewPaise
    const netPaise   = Math.round(grossPaise * (tier.share / 100))

    ops.push(
      CreatorEarning.create({
        creatorId:        piece.creatorId,
        contentId:        piece._id,
        month, year,
        viewCount:        monthlyViews,
        ratePerViewPaise,
        grossAmountPaise: grossPaise,
        revenueSharePct:  tier.share,
        netAmountPaise:   netPaise,
        status:           'pending',
        calculatedAt:     new Date(),
      })
      .then(() => Content.findByIdAndUpdate(piece._id, { $set: { viewCountSnapshot: piece.viewCount } }))
      .catch((err) => {
        if (err.code === 11000) return  // concurrent run already created this record — safe to ignore
        throw err
      })
    )
    created++
  }

  await Promise.all(ops)
  return { month, year, created, skipped }
}

async function runEarningsCheck() {
  // Only calculate for the previous completed month
  const now   = new Date()
  const month = now.getMonth() === 0 ? 12 : now.getMonth()       // previous month (1-12)
  const year  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()

  try {
    const result = await calculateMonthlyEarnings(month, year)
    if (result.created > 0) {
      console.log(`[earnings] ${result.created} record(s) created for ${year}-${String(month).padStart(2,'0')}, ${result.skipped} skipped`)
    }
  } catch (err) {
    console.error('[earnings] calculation failed:', err.message)
  }
}

function msUntilNextRun() {
  const now  = new Date()
  // Schedule for the 2nd of each month at 02:00 local time (gives 1st some buffer)
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 2, 2, 0, 0, 0)
  return next.getTime() - now.getTime()
}

function runEarningsCheckLocked() {
  // Only one instance should run this at a time — redundant on correctness
  // grounds (calculateMonthlyEarnings is already safe under concurrent
  // calls via the unique contentId+year+month index) but avoids every
  // instance redoing the same full-catalog aggregation each run.
  return withJobLock('earnings-calculation', LOCK_TTL_MS, runEarningsCheck)
    .catch((err) => console.error('[earnings] lock acquisition failed:', err.message))
}

export function startEarningsJob() {
  if (process.env.NODE_ENV === 'test') return

  // Run once at startup to catch any month that was missed during downtime
  runEarningsCheckLocked()

  // Schedule the next run, then repeat monthly
  function scheduleNext() {
    const delay = msUntilNextRun()
    console.log(`[earnings] next run in ${Math.round(delay / 86_400_000)} day(s)`)
    setTimeout(() => {
      runEarningsCheckLocked()
      scheduleNext()   // re-schedule for the month after that
    }, delay).unref()
  }

  scheduleNext()
}

/**
 * payoutJob.js
 *
 * Scheduled RazorpayX auto-payout run. Mirrors earningsJob.js's job-lock and
 * self-rescheduling pattern. Entirely a no-op until RAZORPAY_X_ACCOUNT_NUMBER
 * is configured — see providers/razorpayPayout.js's isPayoutConfigured().
 *
 * Each run does two things:
 *   1. Auto-creates a 'requested' CreatorPayout for any creator who has
 *      cleared the ₹1,000 threshold, has payout details on file, and has no
 *      request already in flight — so creators don't have to remember to
 *      click "Request Payout" themselves.
 *   2. Fulfils every 'requested' CreatorPayout (including ones the creator
 *      filed manually via POST /api/creator/payouts/request) by creating a
 *      RazorpayX contact + fund account (lazily, once per creator) and
 *      issuing the payout. Final settlement ('paid') also happens via the
 *      payout.processed webhook in routes/payments.js — this just moves the
 *      record to 'processing' and fires the transfer.
 *
 * Creators without payout details on file are left in 'requested' status,
 * untouched, for the existing manual admin payout flow.
 */

import { User }           from '../models/User.js'
import { CreatorEarning }  from '../models/CreatorEarning.js'
import { CreatorPayout }   from '../models/CreatorPayout.js'
import { withJobLock }     from './jobLock.js'
import {
  isPayoutConfigured,
  createContact,
  createFundAccount,
  createPayout,
} from '../providers/razorpayPayout.js'

const LOCK_TTL_MS = 30 * 60 * 1000
const PAYOUT_MIN_RUPEES = 1000  // mirrors routes/creator.js's PAYOUT_MIN_RUPEES

async function autoCreateRequests() {
  const eligible = await CreatorEarning.aggregate([
    { $match: { status: 'pending' } },
    { $group: { _id: '$creatorId', pendingPaise: { $sum: '$netAmountPaise' } } },
    { $match: { pendingPaise: { $gte: PAYOUT_MIN_RUPEES * 100 } } },
  ])
  if (!eligible.length) return 0

  let created = 0
  for (const row of eligible) {
    const inFlight = await CreatorPayout.exists({
      creatorId: row._id,
      status:    { $in: ['requested', 'processing'] },
    })
    if (inFlight) continue

    const creator = await User.findById(row._id).select('creatorPayoutDetails').lean()
    const method  = creator?.creatorPayoutDetails?.method
    if (!method) continue   // no payout details on file — leave for manual flow

    await CreatorPayout.create({
      creatorId:   row._id,
      amountPaise: row.pendingPaise,
      status:      'requested',
      method:      method === 'upi' ? 'UPI' : 'Bank Transfer',
      notes:       'Auto-requested by scheduled payout job',
    })
    created++
  }
  return created
}

async function fulfillRequest(payout) {
  const creator = await User.findById(payout.creatorId)
  const details = creator?.creatorPayoutDetails
  if (!creator || !details?.method) return false  // no payout details — leave for manual flow

  payout.status = 'processing'
  await payout.save()

  try {
    const earnings = await CreatorEarning.find({ creatorId: creator._id, status: 'pending' }).lean()
    const amountPaise = earnings.reduce((s, e) => s + e.netAmountPaise, 0)
    if (amountPaise <= 0) {
      throw new Error('No pending earnings remain at fulfillment time')
    }

    let contactId = details.razorpayContactId
    if (!contactId) {
      const contact = await createContact({
        name:        creator.creatorProfile?.studioName || creator.displayName || creator.email,
        email:       creator.email,
        referenceId: creator._id.toString(),
      })
      contactId = contact.id
      creator.creatorPayoutDetails.razorpayContactId = contactId
    }

    let fundAccountId = details.razorpayFundAccountId
    if (!fundAccountId) {
      const fundAccount = await createFundAccount({
        contactId,
        method:            details.method,
        accountHolderName: details.accountHolderName,
        accountNumber:     details.accountNumber,
        ifsc:              details.ifsc,
        upiId:             details.upiId,
      })
      fundAccountId = fundAccount.id
      creator.creatorPayoutDetails.razorpayFundAccountId = fundAccountId
    }
    await creator.save()

    const rzpPayout = await createPayout({
      fundAccountId,
      amountPaise,
      mode:         details.method === 'upi' ? 'UPI' : 'IMPS',
      referenceId:  payout._id.toString(),
      narration:    `Dhara creator payout — ${creator.creatorProfile?.studioName || creator.email}`,
    })

    payout.amountPaise = amountPaise
    payout.earningIds  = earnings.map((e) => e._id)
    payout.referenceId = rzpPayout.id
    payout.notes        = `${payout.notes ? payout.notes + ' | ' : ''}Issued via RazorpayX (${rzpPayout.status || 'queued'})`
    // Final state ('paid') is confirmed by the payout.processed webhook; mark
    // optimistically paid only if RazorpayX already reports it processed.
    if (rzpPayout.status === 'processed') {
      payout.status = 'paid'
      payout.paidAt  = new Date()
    }
    await payout.save()

    await CreatorEarning.updateMany(
      { _id: { $in: payout.earningIds } },
      { $set: { status: 'paid', payoutId: payout._id } }
    )
    return true
  } catch (err) {
    payout.status = 'failed'
    payout.notes  = `${payout.notes ? payout.notes + ' | ' : ''}Auto-payout failed: ${err.message}`
    await payout.save()
    console.error(`[payout] auto-payout failed for creator ${creator._id}:`, err.message)
    return false
  }
}

export async function runPayoutBatch() {
  if (!isPayoutConfigured()) {
    return { configured: false, requested: 0, fulfilled: 0, failed: 0 }
  }

  const requestedCount = await autoCreateRequests()

  const pending = await CreatorPayout.find({ status: 'requested' }).sort({ createdAt: 1 })
  let fulfilled = 0, failed = 0
  for (const payout of pending) {
    const ok = await fulfillRequest(payout)
    if (ok) fulfilled++; else failed++
  }

  return { configured: true, requested: requestedCount, fulfilled, failed }
}

async function runPayoutCheck() {
  try {
    const result = await runPayoutBatch()
    if (result.configured && (result.requested || result.fulfilled || result.failed)) {
      console.log(`[payout] auto-requested ${result.requested}, fulfilled ${result.fulfilled}, failed ${result.failed}`)
    }
  } catch (err) {
    console.error('[payout] batch run failed:', err.message)
  }
}

function msUntilNextRun() {
  const now  = new Date()
  // Schedule for the 15th of each month at 03:00 local — matches the
  // "Monthly payouts on the 15th" messaging in CreatorStudio's UI.
  let next = new Date(now.getFullYear(), now.getMonth(), 15, 3, 0, 0, 0)
  if (next <= now) next = new Date(now.getFullYear(), now.getMonth() + 1, 15, 3, 0, 0, 0)
  return next.getTime() - now.getTime()
}

export function runPayoutCheckLocked() {
  return withJobLock('creator-payout-run', LOCK_TTL_MS, runPayoutCheck)
    .catch((err) => console.error('[payout] lock acquisition failed:', err.message))
}

export function startPayoutJob() {
  if (process.env.NODE_ENV === 'test') return

  // Run once at startup to catch a payout date that was missed during
  // downtime. Safe to repeat on every restart — already-paid records are
  // never touched, and autoCreateRequests() skips creators with an
  // in-flight request.
  runPayoutCheckLocked()

  function scheduleNext() {
    const delay = msUntilNextRun()
    console.log(`[payout] next auto-payout run in ${Math.round(delay / 86_400_000)} day(s)`)
    setTimeout(() => {
      runPayoutCheckLocked()
      scheduleNext()
    }, delay).unref()
  }

  scheduleNext()
}

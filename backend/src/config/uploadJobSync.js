/**
 * uploadJobSync.js
 *
 * Periodically advances in-flight UploadJobs by polling Bunny's encode status —
 * the exact same syncProcessingJob() the admin "Uploads" tab triggers, but on a
 * timer. Without this, an imported (or creator-uploaded) video only gets linked
 * to its Content/Reel — and becomes publishable — while an admin happens to have
 * the Uploads panel open. On a busy import batch that left videos stuck in
 * "processing" forever once the tab was closed.
 *
 * Non-destructive and safe by default: it only touches jobs already in a
 * transient state (processing/uploading/queued) that have a bunnyVideoId, and
 * does nothing when nothing is in flight. It never deletes anything and never
 * touches the upload pipeline's own request flow.
 */
import { UploadJob } from '../models/UploadJob.js'
import { syncProcessingJob } from '../services/bunnyUpload.js'
import { withJobLock } from './jobLock.js'

const LOCK_TTL_MS  = 10 * 60 * 1000
const BATCH_LIMIT  = 200
const TRANSIENT    = ['processing', 'uploading', 'queued']

async function runSync() {
  const jobs = await UploadJob.find({
    status:       { $in: TRANSIENT },
    bunnyVideoId: { $nin: [null, ''] },
  }).limit(BATCH_LIMIT).lean()
  if (!jobs.length) return

  let advanced = 0
  for (const job of jobs) {
    try {
      const updated = await syncProcessingJob(job)
      if (updated && updated.status !== job.status) advanced++
    } catch (err) {
      console.error(`[upload-sync] job ${job._id} sync failed:`, err.message)
    }
  }
  if (advanced) console.log(`[upload-sync] advanced ${advanced}/${jobs.length} in-flight job(s)`)
}

function runSyncLocked() {
  return withJobLock('upload-job-sync', LOCK_TTL_MS, runSync)
    .catch((err) => console.error('[upload-sync] lock acquisition failed:', err.message))
}

export function startUploadJobSync() {
  if (process.env.NODE_ENV === 'test') return

  const mins = Math.max(1, Number(process.env.UPLOAD_SYNC_INTERVAL_MIN) || 5)
  console.log(`[upload-sync] enabled — every ${mins} min`)

  // First pass shortly after boot to catch anything that finished encoding while
  // the server was down; then on the interval. unref() so it never blocks exit.
  setTimeout(runSyncLocked, 60_000).unref()
  setInterval(runSyncLocked, mins * 60 * 1000).unref()
}

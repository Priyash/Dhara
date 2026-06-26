/**
 * archiveImportWorker.js
 *
 * Drains the persisted ArchiveImportTask queue. Because the queue lives in
 * MongoDB, a backend restart mid-batch doesn't lose work: on startup the worker
 * reclaims anything left mid-flight and finishes the pending items.
 *
 * Concurrency: tasks are claimed with an atomic findOneAndUpdate
 * (pending → processing), so running multiple backend instances is safe — each
 * item is processed exactly once.
 */
import { ArchiveImportTask } from '../models/ArchiveImportTask.js'
import { ArchiveCandidate } from '../models/ArchiveCandidate.js'
import { Content } from '../models/Content.js'
import { Reel } from '../models/Reel.js'
import { User } from '../models/User.js'
import { UploadJob } from '../models/UploadJob.js'
import { StreamCollection } from '../models/StreamCollection.js'
import { ensureArchiveCollection, ensureArchiveReelCreator, queueArchiveImport } from '../services/archiveImport.js'

const REEL_COLLECTION_SLUG = process.env.REEL_COLLECTION_SLUG || 'dhara-reels'

/** Resolve the existing "dhara-reels" Bunny collection used by creator-uploaded reels. Never creates one — reels must reuse the same collection creators upload to. */
async function resolveReelCollection() {
  const collection = await StreamCollection.findOne({ slug: REEL_COLLECTION_SLUG, isActive: true }).lean()
  if (!collection?.bunnyCollectionId) {
    throw new Error(`Reel collection "${REEL_COLLECTION_SLUG}" is not configured.`)
  }
  return collection
}

const STALE_MS             = 10 * 60 * 1000   // a 'processing' task older than this is presumed crashed
const MAX_ATTEMPTS         = 3
const POLL_MS              = 30 * 1000        // safety-net sweep for queued work / stale reclaim
const MAX_CONCURRENT       = 3               // max parallel tasks — prevents starving user-facing requests
const TASK_TIMEOUT_MS      = 5 * 60 * 1000  // 5-min per-task timeout; archive.org can be slow

let draining = false

/** Reset tasks stuck in 'processing' (e.g. a crash) back to 'pending', or fail them after too many tries. */
async function reclaimStale() {
  const cutoff = new Date(Date.now() - STALE_MS)
  await ArchiveImportTask.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: 'pending', claimedAt: null } }
  )
  await ArchiveImportTask.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $gte: MAX_ATTEMPTS } },
    { $set: { status: 'failed', error: 'Gave up after repeated restarts mid-import.' } }
  )
}

/** Atomically claim the oldest pending task. Returns the task or null. */
async function claimNext() {
  return ArchiveImportTask.findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'processing', claimedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true }
  )
}

async function recordFailedJob(collection, title, message) {
  if (!collection) return
  try {
    await UploadJob.create({
      createdByEmail:    'system@archive-import',
      collectionId:      collection._id,
      collectionName:    collection.name,
      bunnyCollectionId: collection.bunnyCollectionId,
      title:             title || 'Archive import',
      status:            'failed',
      progress:          0,
      error:             message || 'Import failed',
    })
  } catch { /* best-effort */ }
}

/** Reflect the real CDN-push outcome on the discovered candidate, if this task came from one. */
function markCandidate(archiveId, status) {
  if (!archiveId) return
  // Never resurrect a candidate the admin explicitly dismissed.
  ArchiveCandidate.updateOne({ archiveId, status: { $ne: 'dismissed' } }, { $set: { status } }).catch(() => {})
}

async function processTask(task, filmCollection) {
  const archiveId = task.item?.archiveId
  const isReel = task.item?.mediaKind === 'reel'
  let collection = filmCollection
  try {
    let reelCreatorId = null
    if (isReel) {
      collection = await resolveReelCollection()
      reelCreatorId = (await ensureArchiveReelCreator({ UserModel: User }))._id
    }
    const result = await queueArchiveImport(task.item, {
      ContentModel: Content,
      ReelModel: Reel,
      UploadJobModel: UploadJob,
      collection,
      allowUnlicensed: task.allowUnlicensed,
      createdByEmail: task.createdByEmail,
      reelCreatorId,
    })
    if (result.created) {
      await ArchiveImportTask.findByIdAndUpdate(task._id, { $set: { status: 'done', contentId: result.id, error: '' } })
      markCandidate(archiveId, 'imported')
    } else if (result.skipped) {
      await ArchiveImportTask.findByIdAndUpdate(task._id, { $set: { status: 'skipped', reason: result.reason } })
      // Nothing will change if retried (duplicate title / no licence) — stop offering it again.
      markCandidate(archiveId, 'imported')
    }
  } catch (err) {
    const message = err?.message || 'Import failed'
    // Retry transient failures by returning the task to the queue until MAX_ATTEMPTS.
    if (task.attempts < MAX_ATTEMPTS) {
      await ArchiveImportTask.findByIdAndUpdate(task._id, { $set: { status: 'pending', claimedAt: null, error: message } })
    } else {
      await ArchiveImportTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: message } })
      await recordFailedJob(collection, task.title || archiveId, message)
      // The CDN push never succeeded — surface it as 'new' again so the next
      // review pass (or a manual retry) gets another shot at it.
      markCandidate(archiveId, 'new')
    }
  }
}

function withTimeout(promise, ms, label) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  )
  return Promise.race([promise, timer])
}

/** Process all currently-pending tasks. Safe to call repeatedly; only one drain runs per process. */
export async function drainImportQueue() {
  if (draining) return
  draining = true
  try {
    await reclaimStale()
    const pending = await ArchiveImportTask.exists({ status: 'pending' })
    if (!pending) return

    const collection = await ensureArchiveCollection({ StreamCollectionModel: StreamCollection })

    // Process up to MAX_CONCURRENT tasks at a time so archive imports don't consume
    // all MongoDB connections and starve user-facing requests.
    while (true) {
      const tasks = []
      for (let i = 0; i < MAX_CONCURRENT; i++) {
        const task = await claimNext()
        if (!task) break
        tasks.push(task)
      }
      if (!tasks.length) break

      await Promise.all(
        tasks.map(task =>
          withTimeout(processTask(task, collection), TASK_TIMEOUT_MS, `task ${task._id}`)
            .catch(err => {
              console.error(`[archive-import-worker] task ${task._id} failed:`, err.message)
              // Mark as failed so stale reclaim doesn't retry indefinitely
              ArchiveImportTask.findByIdAndUpdate(task._id, {
                $set: { status: 'failed', error: err.message },
              }).catch(() => {})
            })
        )
      )
    }
  } catch (err) {
    console.error('[archive-import-worker] drain failed:', err.message)
  } finally {
    draining = false
  }
}

/** Fire-and-forget trigger used by the import route right after enqueuing tasks. */
export function triggerImportDrain() {
  drainImportQueue().catch((err) => console.error('[archive-import-worker]', err.message))
}

export function startArchiveImportWorker() {
  // Resume any work left over from a previous run.
  triggerImportDrain()
  // Safety-net sweep so restarts / multi-instance gaps eventually get picked up.
  const timer = setInterval(triggerImportDrain, POLL_MS)
  timer.unref()
}

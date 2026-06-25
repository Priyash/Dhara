/**
 * cdnReconcile.js
 *
 * Detects archive-imported videos that were deleted directly on Bunny's side
 * (out-of-band — not through this app's own delete routes, which already
 * purge Bunny + free the archiveId). Without this job, a video removed
 * straight from the Bunny dashboard would leave its Content/Reel doc
 * dangling forever, and its archiveId would stay "claimed" so it could never
 * be reimported.
 *
 * Scoped strictly to docs with archiveId != null — i.e. only archive-sourced
 * Content/Reels are ever touched here. Creator-uploaded content and reels
 * (archiveId always null) are never in scope, so this job carries zero risk
 * to the existing creator-studio pipeline.
 *
 * Only a *confirmed* Bunny 404 (bunnyVideoExists() === false) frees up the
 * item. Any ambiguous/transient error (network, auth, Bunny outage) leaves
 * the doc untouched for the next scheduled run — never treated as deletion.
 */
import { Content } from '../models/Content.js'
import { Reel } from '../models/Reel.js'
import { ArchiveCandidate } from '../models/ArchiveCandidate.js'
import { bunnyVideoExists } from '../services/bunnyUpload.js'
import { withJobLock } from './jobLock.js'

const LOCK_TTL_MS = 15 * 60 * 1000

/**
 * Soft-delete a Content/Reel doc — mirrors the existing DELETE /content/:id
 * route's pattern exactly (isDeleted: true, isPublished: false, bunnyVideoId
 * cleared). The dedup pre-check in queueFilm/queueEpisodic/queueReel already
 * scopes on `isDeleted: { $ne: true }`, so this alone makes the archiveId
 * reimportable again — archiveId itself is deliberately left intact so the
 * doc keeps a record of where it was originally sourced from.
 * Also surfaces its discovery candidate (if any) as 'new' again so it
 * reappears in the discovered-candidates review list. Never resurrects a
 * candidate the admin explicitly dismissed.
 */
async function freeUp(Model, doc, archiveId, extraFields = {}) {
  await Model.findByIdAndUpdate(doc._id, {
    $set: { isDeleted: true, isPublished: false, bunnyVideoId: '', ...extraFields },
  })
  if (archiveId) {
    await ArchiveCandidate.updateOne(
      { archiveId, status: { $ne: 'dismissed' } },
      { $set: { status: 'new' } }
    ).catch(() => {})
  }
}

async function reconcileContent() {
  let freed = 0
  const docs = await Content.find({ archiveId: { $ne: null }, isDeleted: { $ne: true } })
    .select('_id title archiveId bunnyVideoId seasons')
    .lean()

  for (const doc of docs) {
    try {
      // Film / Documentary — single root video.
      if (doc.bunnyVideoId) {
        const exists = await bunnyVideoExists(doc.bunnyVideoId)
        if (exists === false) { await freeUp(Content, doc, doc.archiveId); freed++ }
        continue
      }
      // Series / Serial Drama — check every linked episode; if ALL of them
      // are confirmed gone, the whole title is gone from the CDN.
      const episodeIds = (doc.seasons || []).flatMap((s) => s.episodes || []).map((e) => e.bunnyVideoId).filter(Boolean)
      if (episodeIds.length === 0) continue
      let allGone = true
      for (const guid of episodeIds) {
        const exists = await bunnyVideoExists(guid)
        if (exists !== false) { allGone = false; break }  // still exists, or an ambiguous error — don't touch it
      }
      if (allGone) {
        const clearedSeasons = (doc.seasons || []).map((s) => ({
          ...s,
          episodes: (s.episodes || []).map((e) => ({ ...e, bunnyVideoId: '' })),
        }))
        await freeUp(Content, doc, doc.archiveId, { seasons: clearedSeasons })
        freed++
      }
    } catch (err) {
      console.error(`[cdn-reconcile] content "${doc.title}" check failed:`, err.message)
    }
  }
  return freed
}

async function reconcileReels() {
  let freed = 0
  const docs = await Reel.find({ archiveId: { $ne: null }, isDeleted: { $ne: true } })
    .select('_id title archiveId bunnyVideoId')
    .lean()

  for (const doc of docs) {
    if (!doc.bunnyVideoId) continue
    try {
      const exists = await bunnyVideoExists(doc.bunnyVideoId)
      if (exists === false) { await freeUp(Reel, doc, doc.archiveId); freed++ }
    } catch (err) {
      console.error(`[cdn-reconcile] reel "${doc.title}" check failed:`, err.message)
    }
  }
  return freed
}

async function runReconcile() {
  const freedContent = await reconcileContent()
  const freedReels    = await reconcileReels()
  const total = freedContent + freedReels
  if (total > 0) console.log(`[cdn-reconcile] freed ${freedContent} content title(s) and ${freedReels} reel(s) deleted on Bunny's side`)
}

function runReconcileLocked() {
  return withJobLock('cdn-reconcile', LOCK_TTL_MS, runReconcile)
    .catch((err) => console.error('[cdn-reconcile] lock acquisition failed:', err.message))
}

/**
 * Disabled unless CDN_RECONCILE_ENABLED=true (env-gated like the discovery
 * jobs) — opt-in so it can be reviewed/tested in staging before relying on
 * it to soft-delete production catalog entries.
 */
export function startCdnReconcileJob() {
  if (process.env.CDN_RECONCILE_ENABLED !== 'true') return

  const hours = Math.max(1, Number(process.env.CDN_RECONCILE_INTERVAL_H) || 12)
  console.log(`[cdn-reconcile] enabled — every ${hours}h`)

  const startTimer = setTimeout(runReconcileLocked, 120_000)
  startTimer.unref()

  const timer = setInterval(runReconcileLocked, hours * 60 * 60 * 1000)
  timer.unref()
}

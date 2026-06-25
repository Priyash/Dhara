/**
 * archiveDiscovery.js
 *
 * Scheduled, review-only discovery of public-domain titles on archive.org.
 * Periodically searches for new candidates and upserts them as ArchiveCandidate
 * documents with status 'new'. It NEVER imports anything — an admin reviews each
 * candidate in the Archive Import tab and chooses to import or dismiss it.
 *
 * Disabled unless ARCHIVE_DISCOVERY_ENABLED=true. Languages and cadence are
 * configurable via env:
 *   ARCHIVE_DISCOVERY_ENABLED    'true' to turn the job on (default off)
 *   ARCHIVE_DISCOVERY_LANGUAGES  comma-separated, default "Bengali"
 *   ARCHIVE_DISCOVERY_INTERVAL_H interval in hours, default 24
 */
import { ArchiveCandidate } from '../models/ArchiveCandidate.js'
import { searchArchive, fetchArchiveMetadata, pickVideoFile, parseDurationSecs } from '../services/archiveImport.js'
import { REEL_MAX_DURATION_SECS } from '../models/Reel.js'
import { withJobLock } from './jobLock.js'

const LOCK_TTL_MS = 15 * 60 * 1000

// Short-form-friendly collection for the reel-discovery pass — kept separate
// and narrow (vintage commercials/PSAs) so this never competes with or
// pollutes the existing film/series discovery above.
const REEL_DISCOVERY_COLLECTION = 'prelinger'

function languages() {
  return (process.env.ARCHIVE_DISCOVERY_LANGUAGES || 'Bengali')
    .split(',').map((s) => s.trim()).filter(Boolean)
}

async function runDiscovery() {
  let discovered = 0
  for (const language of languages()) {
    try {
      const { items } = await searchArchive({ language, rows: 60 })
      for (const r of items) {
        // Insert only if unseen — never overwrite an existing candidate's status
        // (so dismissed/imported items don't resurface as 'new').
        const res = await ArchiveCandidate.updateOne(
          { archiveId: r.archiveId },
          {
            $setOnInsert: {
              archiveId:    r.archiveId,
              title:        r.title || '',
              year:         r.year || null,
              type:         r.type || 'Film',
              language,
              licenseLabel: r.licenseLabel || '',
              licensed:     Boolean(r.licensed),
              thumbUrl:     r.thumbUrl || '',
              detailUrl:    r.detailUrl || '',
              status:       'new',
              discoveredAt: new Date(),
            },
          },
          { upsert: true }
        )
        if (res.upsertedCount > 0) discovered++
      }
    } catch (err) {
      console.error(`[archive-discovery] "${language}" failed:`, err.message)
    }
  }
  if (discovered > 0) console.log(`[archive-discovery] surfaced ${discovered} new candidate(s)`)
}

function runDiscoveryLocked() {
  return withJobLock('archive-discovery', LOCK_TTL_MS, runDiscovery)
    .catch((err) => console.error('[archive-discovery] lock acquisition failed:', err.message))
}

/**
 * Scheduled, review-only discovery of short-form (<=30s) clips for the Reels
 * feature. Entirely separate from runDiscovery() above — different env flag
 * (default off), different collection, writes candidates tagged
 * mediaKind: 'reel' so the existing review/import UI can distinguish them
 * without any parallel UI. archive.org's search index has no duration field,
 * so each candidate's actual file length is checked via a per-item metadata
 * call before it's ever surfaced — clips that are too long, or whose length
 * can't be determined, are silently skipped (never surfaced, never imported).
 */
async function runReelDiscovery() {
  let discovered = 0
  try {
    const { items } = await searchArchive({ language: '', collections: [REEL_DISCOVERY_COLLECTION], rows: 30 })
    for (const r of items) {
      if (await ArchiveCandidate.exists({ archiveId: r.archiveId })) continue
      let durationSecs = null
      let videoFile = null
      try {
        const archive = await fetchArchiveMetadata(r.archiveId)
        videoFile = pickVideoFile(archive.files || [])
        durationSecs = videoFile ? parseDurationSecs(videoFile.length) : null
      } catch { continue }
      if (!videoFile || durationSecs == null || durationSecs > REEL_MAX_DURATION_SECS) continue

      const res = await ArchiveCandidate.updateOne(
        { archiveId: r.archiveId },
        {
          $setOnInsert: {
            archiveId:    r.archiveId,
            title:        r.title || '',
            year:         r.year || null,
            type:         r.type || 'Film',
            mediaKind:    'reel',
            durationSecs,
            language:     '',
            licenseLabel: r.licenseLabel || '',
            licensed:     Boolean(r.licensed),
            thumbUrl:     r.thumbUrl || '',
            detailUrl:    r.detailUrl || '',
            status:       'new',
            discoveredAt: new Date(),
          },
        },
        { upsert: true }
      )
      if (res.upsertedCount > 0) discovered++
    }
  } catch (err) {
    console.error('[archive-reel-discovery] failed:', err.message)
  }
  if (discovered > 0) console.log(`[archive-reel-discovery] surfaced ${discovered} new reel candidate(s)`)
}

function runReelDiscoveryLocked() {
  return withJobLock('archive-reel-discovery', LOCK_TTL_MS, runReelDiscovery)
    .catch((err) => console.error('[archive-reel-discovery] lock acquisition failed:', err.message))
}

export function startArchiveDiscoveryJob() {
  if (process.env.ARCHIVE_DISCOVERY_ENABLED !== 'true') return

  const hours = Math.max(1, Number(process.env.ARCHIVE_DISCOVERY_INTERVAL_H) || 24)
  console.log(`[archive-discovery] enabled — every ${hours}h for: ${languages().join(', ')}`)

  // Delay the first run a little so startup isn't competing with boot work.
  const startTimer = setTimeout(runDiscoveryLocked, 60_000)
  startTimer.unref()

  const timer = setInterval(runDiscoveryLocked, hours * 60 * 60 * 1000)
  timer.unref()
}

export function startArchiveReelDiscoveryJob() {
  if (process.env.ARCHIVE_REEL_DISCOVERY_ENABLED !== 'true') return

  const hours = Math.max(1, Number(process.env.ARCHIVE_REEL_DISCOVERY_INTERVAL_H) || 24)
  console.log(`[archive-reel-discovery] enabled — every ${hours}h for collection: ${REEL_DISCOVERY_COLLECTION}`)

  const startTimer = setTimeout(runReelDiscoveryLocked, 90_000)
  startTimer.unref()

  const timer = setInterval(runReelDiscoveryLocked, hours * 60 * 60 * 1000)
  timer.unref()
}

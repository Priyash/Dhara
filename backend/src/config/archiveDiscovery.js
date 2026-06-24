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
import { searchArchive } from '../services/archiveImport.js'
import { withJobLock } from './jobLock.js'

const LOCK_TTL_MS = 15 * 60 * 1000

function languages() {
  return (process.env.ARCHIVE_DISCOVERY_LANGUAGES || 'Bengali')
    .split(',').map((s) => s.trim()).filter(Boolean)
}

async function runDiscovery() {
  let discovered = 0
  for (const language of languages()) {
    try {
      const results = await searchArchive({ language, rows: 60 })
      for (const r of results) {
        // Insert only if unseen — never overwrite an existing candidate's status
        // (so dismissed/imported items don't resurface as 'new').
        const res = await ArchiveCandidate.updateOne(
          { archiveId: r.archiveId },
          {
            $setOnInsert: {
              archiveId:    r.archiveId,
              title:        r.title || '',
              year:         r.year || null,
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

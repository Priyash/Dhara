import { withJobLock } from './jobLock.js'
import { Content } from '../models/Content.js'
import { Reel } from '../models/Reel.js'

/**
 * One-time, idempotent repair for the bunnyVideoId unique index.
 *
 * The index was originally declared `{ unique: true, sparse: true }`. Sparse
 * only excludes documents where the field is *absent* — a document with
 * bunnyVideoId:'' (which the admin soft-delete/reject paths write) IS indexed.
 * So the second item you soft-delete collides with the first on E11000, and the
 * delete fails ("Plan executor error during findAndModify … dup key { bunnyVideoId: '' }").
 *
 * The models now declare a *partial* index covering only non-empty strings, but
 * Mongoose's autoIndex can't convert an existing index in place — creating the
 * new spec over the old name raises IndexOptionsConflict and silently leaves the
 * broken index in place. This routine drops the legacy index so the partial one
 * can take over, and normalises existing empty-string values to "unset" for
 * tidiness. Safe to run on every boot: once the index is already partial and no
 * empty strings remain, every step is a no-op.
 */

// Must match the partialFilterExpression declared on the models.
const PARTIAL_FILTER = { bunnyVideoId: { $type: 'string', $gt: '' } }

/**
 * Decide whether an existing `bunnyVideoId_1` index entry (from
 * collection.indexes()) is the legacy form that must be dropped before the
 * partial index can be created. Returns true only when the index exists and is
 * NOT already partial — i.e. the old `sparse`/plain unique index. Pure so it can
 * be unit-tested without a live MongoDB.
 */
export function legacyIndexNeedsDrop(indexInfo) {
  return !!indexInfo && !indexInfo.partialFilterExpression
}

async function repairCollection(model, label) {
  const coll = model.collection

  // 1. Normalise empty-string GUIDs → unset. Empty strings are meaningless here
  //    ("no video") and only existed because soft-delete wrote '' rather than
  //    clearing the field. Removing them keeps the data consistent with the
  //    archive importer, which omits the field entirely.
  const { modifiedCount = 0 } = await coll.updateMany(
    { bunnyVideoId: '' },
    { $unset: { bunnyVideoId: '' } }
  )
  if (modifiedCount) console.log(`[bunny-index] ${label}: cleared ${modifiedCount} empty bunnyVideoId value(s)`)

  // 2. Drop the legacy index if it isn't already the partial form.
  let indexes = []
  try {
    indexes = await coll.indexes()
  } catch (err) {
    console.error(`[bunny-index] ${label}: could not list indexes:`, err.message)
    return
  }
  const existing = indexes.find((i) => i.name === 'bunnyVideoId_1')
  if (legacyIndexNeedsDrop(existing)) {
    try {
      await coll.dropIndex('bunnyVideoId_1')
      console.log(`[bunny-index] ${label}: dropped legacy sparse unique index`)
    } catch (err) {
      if (err.codeName !== 'IndexNotFound') {
        console.error(`[bunny-index] ${label}: dropIndex failed:`, err.message)
        return
      }
    }
  }

  // 3. Ensure the partial unique index exists (idempotent — no-op if already there).
  try {
    await coll.createIndex(
      { bunnyVideoId: 1 },
      { unique: true, partialFilterExpression: PARTIAL_FILTER }
    )
  } catch (err) {
    console.error(`[bunny-index] ${label}: createIndex failed:`, err.message)
  }
}

export async function runBunnyIndexMigration() {
  if (process.env.NODE_ENV === 'test') return
  try {
    await withJobLock('bunny-index-migration', 60_000, async () => {
      await repairCollection(Content, 'Content')
      await repairCollection(Reel, 'Reel')
      console.log('[bunny-index] migration complete')
    })
  } catch (err) {
    // Never let an index repair take down startup.
    console.error('[bunny-index] migration failed:', err.message)
  }
}

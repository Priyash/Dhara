/**
 * Archive.org import logic tests. Imports the real, pure helpers directly
 * (parseDurationSecs, detectLicense, pickVideoFile) and exercises
 * queueReel()/ensureArchiveReelCreator() against lightweight stub models —
 * no real DB, no real Bunny/archive.org network calls. Network-touching
 * helpers (fetchArchiveMetadata, bunnyFetchFromUrl) are stubbed out via
 * dependency injection at the model layer, never monkey-patched on the
 * module, so the assertions exercise the actual control flow.
 */
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { parseDurationSecs, detectLicense, pickVideoFile } from '../src/services/archiveImport.js'

// ── parseDurationSecs ─────────────────────────────────────────────────────────

describe('parseDurationSecs', () => {
  it('parses a plain-seconds string', () => assert.equal(parseDurationSecs('25'), 25))
  it('parses a plain-seconds string with decimals', () => assert.equal(parseDurationSecs('25.6'), 26))
  it('parses HH:MM:SS', () => assert.equal(parseDurationSecs('00:00:28'), 28))
  it('parses MM:SS', () => assert.equal(parseDurationSecs('01:05'), 65))
  it('parses HH:MM:SS with hours', () => assert.equal(parseDurationSecs('01:00:00'), 3600))
  it('returns null for null', () => assert.equal(parseDurationSecs(null), null))
  it('returns null for empty string', () => assert.equal(parseDurationSecs(''), null))
  it('returns null for garbage', () => assert.equal(parseDurationSecs('not-a-duration'), null))
  it('returns null for partially-garbage colon strings', () => assert.equal(parseDurationSecs('ab:cd'), null))
})

// ── detectLicense / pickVideoFile sanity (pre-existing, re-confirmed) ────────

describe('detectLicense', () => {
  it('flags Creative Commons license URLs as ok', () => {
    assert.equal(detectLicense({ licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }).ok, true)
  })
  it('flags unknown rights as not ok', () => {
    assert.equal(detectLicense({ rights: 'all rights reserved' }).ok, false)
  })
})

describe('pickVideoFile', () => {
  it('picks the largest mp4 candidate', () => {
    const files = [
      { name: 'a.mp4', size: '100' },
      { name: 'b.mp4', size: '500' },
    ]
    assert.equal(pickVideoFile(files).name, 'b.mp4')
  })
  it('returns null when no mp4/h.264 file exists', () => {
    assert.equal(pickVideoFile([{ name: 'a.txt', size: '10' }]), null)
  })
})

// ── ensureArchiveReelCreator — upsert semantics ──────────────────────────────

describe('ensureArchiveReelCreator', async () => {
  const { ensureArchiveReelCreator } = await import('../src/services/archiveImport.js')

  it('upserts on the synthetic system firebaseUid, never creates a duplicate', async () => {
    const findOneAndUpdate = mock.fn(async (filter) => ({ _id: 'system-user-id', ...filter }))
    const UserModel = { findOneAndUpdate }
    const user = await ensureArchiveReelCreator({ UserModel })
    assert.equal(findOneAndUpdate.mock.calls.length, 1)
    const [filter, update, opts] = findOneAndUpdate.mock.calls[0].arguments
    assert.equal(filter.firebaseUid, 'system:archive-import')
    assert.equal(opts.upsert, true)
    assert.ok(update.$setOnInsert.isCreator)
    assert.equal(user._id, 'system-user-id')
  })
})

// ── queueReel — dedup / license / duration gates ─────────────────────────────

describe('queueReel (via queueArchiveImport dispatch)', async () => {
  const { queueArchiveImport } = await import('../src/services/archiveImport.js')

  const collection = { _id: 'col1', name: 'Reels', bunnyCollectionId: 'bunny-col-1' }
  const baseItem = { mediaKind: 'reel', archiveId: 'short-clip-1', title: 'Vintage Ad' }

  function makeReelModel({ existing = null } = {}) {
    return {
      findOne: mock.fn(() => ({ lean: async () => existing })),
      create: mock.fn(async (data) => ({ _id: 'reel-1', ...data })),
    }
  }

  it('skips when a non-deleted reel with this archiveId already exists', async () => {
    const ReelModel = makeReelModel({ existing: { _id: 'existing-reel' } })
    const result = await queueArchiveImport(baseItem, {
      ReelModel, UploadJobModel: {}, collection, reelCreatorId: 'creator-1',
    })
    assert.equal(result.skipped, true)
    assert.equal(result.reason, 'already imported')
    assert.equal(ReelModel.create.mock.calls.length, 0)
  })

  it('throws if creatorId is missing (Reel.creatorId is required)', async () => {
    const ReelModel = makeReelModel()
    await assert.rejects(
      () => queueArchiveImport(baseItem, { ReelModel, UploadJobModel: {}, collection }),
      /creatorId/
    )
  })
})

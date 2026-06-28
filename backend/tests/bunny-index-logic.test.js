/**
 * bunnyIndexMigration.legacyIndexNeedsDrop — the decision that drives the
 * one-time repair of the bunnyVideoId unique index (legacy sparse → partial,
 * which fixes the E11000 dup-key { bunnyVideoId: "" } on content/reel delete).
 * Pure predicate; no DB.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { legacyIndexNeedsDrop } from '../src/config/bunnyIndexMigration.js'

describe('legacyIndexNeedsDrop', () => {
  it('drops a legacy sparse unique index (no partialFilterExpression)', () => {
    assert.equal(
      legacyIndexNeedsDrop({ name: 'bunnyVideoId_1', key: { bunnyVideoId: 1 }, unique: true, sparse: true }),
      true
    )
  })

  it('drops a plain unique index with no partial filter', () => {
    assert.equal(
      legacyIndexNeedsDrop({ name: 'bunnyVideoId_1', key: { bunnyVideoId: 1 }, unique: true }),
      true
    )
  })

  it('leaves an already-partial index alone', () => {
    assert.equal(
      legacyIndexNeedsDrop({
        name: 'bunnyVideoId_1',
        key: { bunnyVideoId: 1 },
        unique: true,
        partialFilterExpression: { bunnyVideoId: { $type: 'string', $gt: '' } },
      }),
      false
    )
  })

  it('is a no-op when the index does not exist yet (fresh DB)', () => {
    assert.equal(legacyIndexNeedsDrop(undefined), false)
    assert.equal(legacyIndexNeedsDrop(null), false)
  })
})

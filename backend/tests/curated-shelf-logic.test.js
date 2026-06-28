/**
 * CuratedShelf.liveFilter — the read-time festival-window filter that makes an
 * "Utsab" rail auto-surface and retire. Pure Mongo-filter shape; no DB.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CuratedShelf } from '../src/models/CuratedShelf.js'

describe('CuratedShelf.liveFilter', () => {
  const now = new Date('2026-10-05T00:00:00Z')
  const f = CuratedShelf.liveFilter(now)

  it('always requires an active shelf', () => {
    assert.equal(f.isActive, true)
  })

  it('admits open-ended shelves (null bounds) and threads `now` into the bounds', () => {
    const [fromClause, toClause] = f.$and
    // activeFrom: null OR activeFrom <= now
    assert.deepEqual(fromClause.$or[0], { activeFrom: null })
    assert.deepEqual(fromClause.$or[1], { activeFrom: { $lte: now } })
    // activeTo: null OR activeTo >= now
    assert.deepEqual(toClause.$or[0], { activeTo: null })
    assert.deepEqual(toClause.$or[1], { activeTo: { $gte: now } })
  })

  it('defaults `now` to the current time when omitted', () => {
    const f2 = CuratedShelf.liveFilter()
    assert.ok(f2.$and[0].$or[1].activeFrom.$lte instanceof Date)
  })
})

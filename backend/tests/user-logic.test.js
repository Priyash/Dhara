/**
 * User data management logic — no DB required.
 * Tests watchlist cap, watch-progress cap, continue-watching filter,
 * and watch-progress upsert semantics mirrored from routes/user.js.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ── Watchlist ─────────────────────────────────────────────────────────────────

describe('Watchlist — 500-entry cap', () => {
  // Backend uses $push { $slice: -500 } — keeps the last 500 entries
  function applyWatchlistCap(list, max = 500) {
    return list.length > max ? list.slice(-max) : list
  }

  it('leaves list unchanged when under the cap', () => {
    const list = Array.from({ length: 10 }, (_, i) => `id_${i}`)
    assert.equal(applyWatchlistCap(list).length, 10)
  })

  it('trims to exactly 500 when over the cap', () => {
    const list = Array.from({ length: 600 }, (_, i) => `id_${i}`)
    assert.equal(applyWatchlistCap(list).length, 500)
  })

  it('keeps the most recent 500 entries (drops oldest)', () => {
    // 502 items → cap drops the 2 oldest
    const list = ['oldest_A', 'oldest_B', ...Array.from({ length: 500 }, (_, i) => `new_${i}`)]
    const result = applyWatchlistCap(list)
    assert.equal(result.length, 500)
    assert.ok(!result.includes('oldest_A'), 'oldest_A should be dropped')
    assert.ok(!result.includes('oldest_B'), 'oldest_B should be dropped')
    assert.ok(result.includes('new_499'))
  })

  it('returns same reference for list exactly at cap', () => {
    const list = Array.from({ length: 500 }, (_, i) => `id_${i}`)
    const result = applyWatchlistCap(list)
    assert.equal(result.length, 500)
    assert.equal(result[0], 'id_0')
  })
})

// ── Watch progress ────────────────────────────────────────────────────────────

describe('Watch progress — 30-entry cap', () => {
  // Backend uses $push { $slice: 30 } with $position: 0 (newest first)
  function applyProgressCap(entries, max = 30) {
    return entries.slice(0, max)
  }

  it('keeps at most 30 entries', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ contentId: `id_${i}`, positionSecs: i * 10 }))
    assert.equal(applyProgressCap(entries).length, 30)
  })

  it('keeps fewer than 30 entries unchanged', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ contentId: `id_${i}`, positionSecs: 100 }))
    assert.equal(applyProgressCap(entries).length, 5)
  })

  it('retains the first (most recent) entries', () => {
    const entries = [
      { contentId: 'latest', positionSecs: 999 },
      ...Array.from({ length: 35 }, (_, i) => ({ contentId: `old_${i}`, positionSecs: i })),
    ]
    const result = applyProgressCap(entries)
    assert.equal(result[0].contentId, 'latest')
    assert.equal(result.length, 30)
  })
})

describe('Watch progress — upsert deduplication', () => {
  // Backend pulls the existing entry for (contentId, episodeNumber) before pushing
  function upsertProgress(entries, incoming) {
    const filtered = entries.filter(e =>
      !(e.contentId === incoming.contentId &&
        (e.episodeNumber ?? null) === (incoming.episodeNumber ?? null))
    )
    return [incoming, ...filtered].slice(0, 30)
  }

  it('replaces an existing entry for the same content', () => {
    const entries = [{ contentId: 'movie1', episodeNumber: null, positionSecs: 100 }]
    const result = upsertProgress(entries, { contentId: 'movie1', episodeNumber: null, positionSecs: 200 })
    const movie1Entries = result.filter(e => e.contentId === 'movie1')
    assert.equal(movie1Entries.length, 1)
    assert.equal(movie1Entries[0].positionSecs, 200)
  })

  it('adds a new entry for a different episode number', () => {
    const entries = [{ contentId: 'series1', episodeNumber: 1, positionSecs: 100 }]
    const result = upsertProgress(entries, { contentId: 'series1', episodeNumber: 2, positionSecs: 50 })
    assert.equal(result.filter(e => e.contentId === 'series1').length, 2)
  })

  it('places the new entry at the front (most recent first)', () => {
    const entries = [{ contentId: 'old_movie', episodeNumber: null, positionSecs: 50 }]
    const incoming = { contentId: 'new_movie', episodeNumber: null, positionSecs: 120 }
    const result = upsertProgress(entries, incoming)
    assert.equal(result[0].contentId, 'new_movie')
  })
})

// ── Continue watching filter ───────────────────────────────────────────────────

describe('Continue watching — filter', () => {
  // Mirrors the filter in GET /api/user/continue-watching
  function filterForContinue(progress) {
    return progress.filter(p =>
      p.positionSecs > 30 &&
      (p.durationSecs === 0 || p.positionSecs < p.durationSecs - 30)
    )
  }

  it('excludes entries with ≤30s watched', () => {
    const result = filterForContinue([
      { positionSecs: 10, durationSecs: 3600 },
      { positionSecs: 30, durationSecs: 3600 },
      { positionSecs: 31, durationSecs: 3600 },
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].positionSecs, 31)
  })

  it('excludes entries within last 30s of a known duration', () => {
    const result = filterForContinue([
      { positionSecs: 3575, durationSecs: 3600 }, // 25s before end — finished
      { positionSecs: 3570, durationSecs: 3600 }, // 30s before end — boundary, excluded
      { positionSecs: 3000, durationSecs: 3600 }, // well before end — included
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].positionSecs, 3000)
  })

  it('includes entries with unknown duration (durationSecs = 0)', () => {
    const result = filterForContinue([{ positionSecs: 120, durationSecs: 0 }])
    assert.equal(result.length, 1)
  })

  it('returns empty array for empty input', () => {
    assert.deepEqual(filterForContinue([]), [])
  })

  it('filters multiple valid entries', () => {
    const result = filterForContinue([
      { positionSecs: 60,  durationSecs: 1800 },
      { positionSecs: 900, durationSecs: 1800 },
      { positionSecs: 5,   durationSecs: 600  },
    ])
    assert.equal(result.length, 2)
  })
})

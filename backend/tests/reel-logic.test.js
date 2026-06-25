/**
 * Reel logic unit tests — no DB, no Bunny API.
 * Tests duration cap enforcement, hashtag normalisation, reel visibility filtering,
 * and the view-recording threshold.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { REEL_MAX_DURATION_SECS } from '../src/models/Reel.js'

const VIEW_MIN_POSITION_SECS = 5   // mirrors reels.js route constant

// ── Duration cap ──────────────────────────────────────────────────────────────

describe('Reel duration cap', () => {
  function isDurationValid(secs) {
    return Number.isFinite(secs) && secs >= 0 && secs <= REEL_MAX_DURATION_SECS
  }

  it('accepts 0 s (not yet measured)', ()   => assert.equal(isDurationValid(0),   true))
  it('accepts exactly the cap',        ()   => assert.equal(isDurationValid(REEL_MAX_DURATION_SECS),     true))
  it('rejects one second over the cap',()   => assert.equal(isDurationValid(REEL_MAX_DURATION_SECS + 1), false))
  it('rejects negative duration',     ()   => assert.equal(isDurationValid(-1),  false))
  it('rejects NaN',                   ()   => assert.equal(isDurationValid(NaN), false))
  it('rejects Infinity',              ()   => assert.equal(isDurationValid(Infinity), false))
})

// ── Hashtag normalisation ─────────────────────────────────────────────────────

describe('Hashtag normalisation', () => {
  function normalizeHashtags(raw) {
    return [...new Set(
      (Array.isArray(raw) ? raw : [])
        .map((t) => String(t).toLowerCase().replace(/^#/, '').trim())
        .filter(Boolean)
    )]
  }

  it('strips leading #', () => {
    assert.deepEqual(normalizeHashtags(['#bengali']), ['bengali'])
  })

  it('lowercases tags', () => {
    assert.deepEqual(normalizeHashtags(['Bengali', 'COMEDY']), ['bengali', 'comedy'])
  })

  it('deduplicates identical tags', () => {
    assert.deepEqual(normalizeHashtags(['comedy', 'comedy', '#comedy']), ['comedy'])
  })

  it('trims whitespace', () => {
    assert.deepEqual(normalizeHashtags([' drama ']), ['drama'])
  })

  it('filters empty strings', () => {
    assert.deepEqual(normalizeHashtags(['', '  ', '#']), [])
  })

  it('handles non-array input gracefully', () => {
    assert.deepEqual(normalizeHashtags(null), [])
    assert.deepEqual(normalizeHashtags(undefined), [])
    assert.deepEqual(normalizeHashtags('comedy'), [])
  })

  it('preserves order on first occurrence', () => {
    assert.deepEqual(normalizeHashtags(['b', 'a', 'b']), ['b', 'a'])
  })
})

// ── Reel visibility filter ────────────────────────────────────────────────────

describe('Reel public visibility', () => {
  function isPubliclyVisible(reel) {
    return (
      reel.isPublished === true &&
      reel.isDeleted   !== true &&
      reel.submissionStatus === 'approved'
    )
  }

  it('shows a published approved reel', () => {
    assert.equal(isPubliclyVisible({ isPublished: true, isDeleted: false, submissionStatus: 'approved' }), true)
  })

  it('hides an unpublished reel', () => {
    assert.equal(isPubliclyVisible({ isPublished: false, isDeleted: false, submissionStatus: 'approved' }), false)
  })

  it('hides a deleted reel', () => {
    assert.equal(isPubliclyVisible({ isPublished: true, isDeleted: true, submissionStatus: 'approved' }), false)
  })

  it('hides a pending reel', () => {
    assert.equal(isPubliclyVisible({ isPublished: false, isDeleted: false, submissionStatus: 'pending' }), false)
  })

  it('hides a rejected reel', () => {
    assert.equal(isPubliclyVisible({ isPublished: false, isDeleted: false, submissionStatus: 'rejected' }), false)
  })

  it('hides a published-but-pending reel (pending overrides)', () => {
    assert.equal(isPubliclyVisible({ isPublished: true, isDeleted: false, submissionStatus: 'pending' }), false)
  })
})

// ── View recording threshold ──────────────────────────────────────────────────

describe('Reel view threshold', () => {
  function shouldCountView(positionSecs) {
    return Number.isFinite(positionSecs) && positionSecs >= VIEW_MIN_POSITION_SECS
  }

  it('counts a view at exactly the threshold', () =>
    assert.equal(shouldCountView(VIEW_MIN_POSITION_SECS), true))

  it('counts a view well past threshold', () =>
    assert.equal(shouldCountView(45), true))

  it('does not count at 0 s', () =>
    assert.equal(shouldCountView(0), false))

  it('does not count below threshold', () =>
    assert.equal(shouldCountView(VIEW_MIN_POSITION_SECS - 1), false))

  it('does not count NaN position', () =>
    assert.equal(shouldCountView(NaN), false))
})

// ── Aspect ratio validation ───────────────────────────────────────────────────

describe('Reel aspect ratio', () => {
  const VALID = ['9:16', '16:9', '1:1']

  function isValidAspectRatio(ratio) {
    return VALID.includes(ratio)
  }

  it('accepts 9:16 (vertical)', () => assert.equal(isValidAspectRatio('9:16'),  true))
  it('accepts 16:9 (landscape)', () => assert.equal(isValidAspectRatio('16:9'), true))
  it('accepts 1:1 (square)',    () => assert.equal(isValidAspectRatio('1:1'),   true))
  it('rejects arbitrary string', () => assert.equal(isValidAspectRatio('4:3'),  false))
  it('rejects empty string',    () => assert.equal(isValidAspectRatio(''),      false))
  it('rejects undefined',       () => assert.equal(isValidAspectRatio(undefined), false))
})

/**
 * Content logic unit tests — no DB, no Bunny API.
 * Tests HLS URL building, stream token expiry, rating validation,
 * and content filtering logic mirrored from routes/content.js.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'

// ── HLS URL builder (mirrored from routes/content.js) ────────────────────────

function buildHlsUrl(videoId, sign, { pullZone = 'vz-test.b-cdn.net', tokenKey = 'secret' } = {}) {
  const path    = `/${videoId}/playlist.m3u8`
  const base    = `https://${pullZone}${path}`
  if (!sign) return base

  const expires = Math.floor(Date.now() / 1000) + 3600
  const token   = crypto.createHash('sha256')
    .update(tokenKey + path + expires)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return `${base}?token=${token}&expires=${expires}`
}

// ── Unsigned URL ──────────────────────────────────────────────────────────────

describe('buildHlsUrl — unsigned (free content)', () => {
  it('builds the correct base URL', () => {
    const url = buildHlsUrl('abc123', false)
    assert.equal(url, 'https://vz-test.b-cdn.net/abc123/playlist.m3u8')
  })

  it('includes the videoId in the path', () => {
    const url = buildHlsUrl('xyz999', false)
    assert.ok(url.includes('/xyz999/'))
  })

  it('always ends with playlist.m3u8', () => {
    const url = buildHlsUrl('video1', false)
    assert.ok(url.endsWith('/playlist.m3u8'))
  })

  it('uses the provided pull zone domain', () => {
    const url = buildHlsUrl('id1', false, { pullZone: 'custom-zone.b-cdn.net' })
    assert.ok(url.startsWith('https://custom-zone.b-cdn.net/'))
  })

  it('does not append token query parameters', () => {
    const url = buildHlsUrl('abc', false)
    assert.ok(!url.includes('?'))
  })
})

// ── Signed URL (premium content) ─────────────────────────────────────────────

describe('buildHlsUrl — signed (premium content)', () => {
  it('appends token and expires query parameters', () => {
    const url = buildHlsUrl('abc123', true)
    assert.ok(url.includes('?token='))
    assert.ok(url.includes('&expires='))
  })

  it('token uses URL-safe base64 (no +, /, = chars)', () => {
    const url   = buildHlsUrl('abc123', true)
    const token = new URL(url).searchParams.get('token')
    assert.ok(!/[+/=]/.test(token), `Token contains invalid chars: ${token}`)
  })

  it('expires approximately 1 hour from now', () => {
    const url     = buildHlsUrl('abc123', true)
    const expires = parseInt(new URL(url).searchParams.get('expires'), 10)
    const now     = Math.floor(Date.now() / 1000)
    assert.ok(expires >= now + 3590, `expires ${expires} should be >= ${now + 3590}`)
    assert.ok(expires <= now + 3610, `expires ${expires} should be <= ${now + 3610}`)
  })

  it('different videoIds produce different tokens', () => {
    const url1 = buildHlsUrl('video1', true)
    const url2 = buildHlsUrl('video2', true)
    const t1 = new URL(url1).searchParams.get('token')
    const t2 = new URL(url2).searchParams.get('token')
    assert.notEqual(t1, t2)
  })

  it('different token keys produce different tokens for the same video', () => {
    const url1 = buildHlsUrl('same', true, { tokenKey: 'key_A' })
    const url2 = buildHlsUrl('same', true, { tokenKey: 'key_B' })
    const t1 = new URL(url1).searchParams.get('token')
    const t2 = new URL(url2).searchParams.get('token')
    assert.notEqual(t1, t2)
  })

  it('base URL path is the same as unsigned', () => {
    const signed   = new URL(buildHlsUrl('vid', true))
    const unsigned = new URL(buildHlsUrl('vid', false))
    assert.equal(signed.pathname, unsigned.pathname)
  })
})

// ── Community rating validation ────────────────────────────────────────────────

describe('Rating validation', () => {
  // Mirrors the validation in POST /api/content/:id/rate
  function validateRating(score) {
    const n = Number(score)
    return Number.isInteger(n) && n >= 1 && n <= 5
  }

  it('accepts 1', ()  => assert.equal(validateRating(1), true))
  it('accepts 3', ()  => assert.equal(validateRating(3), true))
  it('accepts 5', ()  => assert.equal(validateRating(5), true))
  it('rejects 0', ()  => assert.equal(validateRating(0), false))
  it('rejects 6', ()  => assert.equal(validateRating(6), false))
  it('rejects -1', () => assert.equal(validateRating(-1), false))
  it('rejects 2.5 (non-integer)', () => assert.equal(validateRating(2.5), false))
  it('rejects "five" (non-numeric)', () => assert.equal(validateRating('five'), false))
  it('rejects null', () => assert.equal(validateRating(null), false))
})

// ── Community rating aggregate ─────────────────────────────────────────────────

describe('Community rating calculation', () => {
  function computeAverage(scores) {
    if (!scores.length) return 0
    const sum = scores.reduce((a, b) => a + b, 0)
    return Math.round((sum / scores.length) * 10) / 10
  }

  it('returns 0 for empty scores', () => assert.equal(computeAverage([]), 0))
  it('returns the score for a single rating', () => assert.equal(computeAverage([4]), 4))
  it('averages two equal scores', () => assert.equal(computeAverage([3, 3]), 3))
  it('rounds to one decimal place', () => assert.equal(computeAverage([1, 2, 3, 4, 5]), 3))
  it('rounds correctly for repeating decimals', () => assert.equal(computeAverage([4, 4, 5]), 4.3))
  it('handles all fives', () => assert.equal(computeAverage([5, 5, 5, 5]), 5))
})

// ── Submission status filtering ───────────────────────────────────────────────

describe('Content submission status filtering', () => {
  // Content with pending/rejected submission should not be visible publicly
  function isPubliclyVisible(content) {
    if (!content.isPublished) return false
    const hidden = ['pending', 'rejected']
    return !content.submissionStatus || !hidden.includes(content.submissionStatus)
  }

  it('shows published content with no submissionStatus (admin-added)', () => {
    assert.equal(isPubliclyVisible({ isPublished: true }), true)
  })

  it('shows published + approved creator content', () => {
    assert.equal(isPubliclyVisible({ isPublished: true, submissionStatus: 'approved' }), true)
  })

  it('hides unpublished content', () => {
    assert.equal(isPubliclyVisible({ isPublished: false }), false)
  })

  it('hides pending creator submissions even if published', () => {
    assert.equal(isPubliclyVisible({ isPublished: true, submissionStatus: 'pending' }), false)
  })

  it('hides rejected creator submissions', () => {
    assert.equal(isPubliclyVisible({ isPublished: true, submissionStatus: 'rejected' }), false)
  })
})

/**
 * Search logic unit tests — no DB required.
 * Tests input validation, regex sanitization (ReDoS prevention),
 * and query-routing decisions mirrored from routes/search.js.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ── Mirrors the logic from routes/search.js ───────────────────────────────────

function sanitize(raw) {
  return (raw || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isTooShort(raw)   { return (raw || '').trim().length < 2 }
function usePrefixSearch(q) { return q.length < 4 }

// ── Input validation ──────────────────────────────────────────────────────────

describe('Search — too-short guard', () => {
  it('rejects empty string', () => assert.equal(isTooShort(''), true))
  it('rejects whitespace-only', () => assert.equal(isTooShort('   '), true))
  it('rejects single char', () => assert.equal(isTooShort('a'), true))
  it('allows two-char query', () => assert.equal(isTooShort('by'), false))
  it('allows full word', () => assert.equal(isTooShort('byomkesh'), false))
})

// ── Query routing ─────────────────────────────────────────────────────────────

describe('Search — query routing (prefix vs full-text)', () => {
  it('routes 2-char query to prefix search', () => assert.equal(usePrefixSearch('by'), true))
  it('routes 3-char query to prefix search', () => assert.equal(usePrefixSearch('byo'), true))
  it('routes 4-char query to full-text search', () => assert.equal(usePrefixSearch('byom'), false))
  it('routes longer query to full-text search', () => assert.equal(usePrefixSearch('byomkesh'), false))
})

// ── ReDoS prevention ──────────────────────────────────────────────────────────

describe('Search — regex sanitization (ReDoS prevention)', () => {
  it('escapes dot metacharacter', () => {
    assert.equal(sanitize('test.query'), 'test\\.query')
  })
  it('escapes asterisk', () => {
    assert.equal(sanitize('a*b'), 'a\\*b')
  })
  it('escapes plus', () => {
    assert.equal(sanitize('(((a+)+)+)'), '\\(\\(\\(a\\+\\)\\+\\)\\+\\)')
  })
  it('escapes dollar sign', () => {
    assert.equal(sanitize('price$99'), 'price\\$99')
  })
  it('escapes square brackets', () => {
    assert.equal(sanitize('[abc]'), '\\[abc\\]')
  })
  it('escapes curly braces', () => {
    assert.equal(sanitize('a{2,3}'), 'a\\{2,3\\}')
  })
  it('escapes pipe', () => {
    assert.equal(sanitize('cat|dog'), 'cat\\|dog')
  })
  it('escapes backslash', () => {
    assert.equal(sanitize('path\\file'), 'path\\\\file')
  })
  it('leaves normal ASCII letters unescaped', () => {
    assert.equal(sanitize('Byomkesh'), 'Byomkesh')
  })
  it('leaves Bengali characters unescaped', () => {
    assert.equal(sanitize('বাংলা'), 'বাংলা')
  })
  it('leaves digits unescaped', () => {
    assert.equal(sanitize('123abc'), '123abc')
  })
  it('trims leading/trailing whitespace before escaping', () => {
    assert.equal(sanitize('  hello  '), 'hello')
  })
  it('handles null/undefined safely', () => {
    assert.equal(sanitize(null), '')
    assert.equal(sanitize(undefined), '')
  })
})

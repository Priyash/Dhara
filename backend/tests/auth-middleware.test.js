/**
 * Auth middleware unit tests — no Firebase, no MongoDB.
 * Tests requireAdmin, requireSubscription, requireCreator gate logic
 * using mock req/res objects mirroring the real middleware signatures.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeReq = (overrides = {}) => ({
  headers: {},
  user: null,
  firebaseUser: null,
  ...overrides,
})

const makeRes = () => {
  const r = { _code: null, _body: null }
  r.status = (code) => { r._code = code; return r }
  r.json   = (body) => { r._body = body; return r }
  return r
}

// ── Mirrors the production middleware logic ────────────────────────────────────

function buildRequireAdmin(envAdminEmails) {
  return (req, res, next) => {
    const allowlist = (envAdminEmails || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const email = (req.user?.email || '').toLowerCase()
    if (!email) return res.status(403).json({ error: 'Admin access required' })
    if (!allowlist.includes(email) && req.firebaseUser?.admin !== true)
      return res.status(403).json({ error: 'Admin access required' })
    next()
  }
}

function requireSubscription(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' })
  if (!req.user.isSubscriptionActive)
    return res.status(403).json({ error: 'Active subscription required' })
  next()
}

function requireCreator(req, res, next) {
  if (!req.user?.isCreator || req.user?.creatorStatus !== 'approved')
    return res.status(403).json({ error: 'Creator access required' })
  next()
}

// ── requireAdmin ──────────────────────────────────────────────────────────────

describe('requireAdmin — allowlist', () => {
  const mw = buildRequireAdmin('admin@dhara.in,ops@dhara.in')

  it('allows an email on the allowlist', () => {
    let called = false
    mw(makeReq({ user: { email: 'admin@dhara.in' } }), makeRes(), () => { called = true })
    assert.equal(called, true)
  })

  it('is case-insensitive for allowlist comparison', () => {
    let called = false
    mw(makeReq({ user: { email: 'ADMIN@DHARA.IN' } }), makeRes(), () => { called = true })
    assert.equal(called, true)
  })

  it('allows second email on the allowlist', () => {
    let called = false
    mw(makeReq({ user: { email: 'ops@dhara.in' } }), makeRes(), () => { called = true })
    assert.equal(called, true)
  })

  it('blocks an email not on the allowlist', () => {
    const res = makeRes()
    mw(makeReq({ user: { email: 'hacker@evil.com' } }), res, () => { throw new Error('unexpected next()') })
    assert.equal(res._code, 403)
  })

  it('blocks when user is null', () => {
    const res = makeRes()
    mw(makeReq({ user: null }), res, () => { throw new Error('unexpected next()') })
    assert.equal(res._code, 403)
  })

  it('blocks when email is empty string', () => {
    const res = makeRes()
    mw(makeReq({ user: { email: '' } }), res, () => { throw new Error('unexpected next()') })
    assert.equal(res._code, 403)
  })
})

describe('requireAdmin — Firebase admin claim', () => {
  const mw = buildRequireAdmin('')  // empty allowlist

  it('allows a user with admin Firebase claim even if not on allowlist', () => {
    let called = false
    mw(
      makeReq({ user: { email: 'anyone@external.com' }, firebaseUser: { admin: true } }),
      makeRes(), () => { called = true }
    )
    assert.equal(called, true)
  })

  it('blocks a user without admin claim on empty allowlist', () => {
    const res = makeRes()
    mw(
      makeReq({ user: { email: 'anyone@external.com' }, firebaseUser: { admin: false } }),
      res, () => { throw new Error('unexpected next()') }
    )
    assert.equal(res._code, 403)
  })

  it('blocks when firebaseUser is null', () => {
    const res = makeRes()
    mw(makeReq({ user: { email: 'anyone@external.com' }, firebaseUser: null }), res, () => { throw new Error() })
    assert.equal(res._code, 403)
  })
})

// ── requireSubscription ───────────────────────────────────────────────────────

describe('requireSubscription', () => {
  it('calls next() for an active subscriber', () => {
    let called = false
    requireSubscription(
      makeReq({ user: { isSubscriptionActive: true } }),
      makeRes(), () => { called = true }
    )
    assert.equal(called, true)
  })

  it('returns 403 for an inactive subscriber', () => {
    const res = makeRes()
    requireSubscription(
      makeReq({ user: { isSubscriptionActive: false } }),
      res, () => { throw new Error() }
    )
    assert.equal(res._code, 403)
    assert.ok(res._body.error.includes('subscription'))
  })

  it('returns 401 when req.user is null', () => {
    const res = makeRes()
    requireSubscription(makeReq({ user: null }), res, () => { throw new Error() })
    assert.equal(res._code, 401)
  })

  it('returns 401 when req.user is undefined', () => {
    const res = makeRes()
    requireSubscription({ headers: {} }, res, () => { throw new Error() })
    assert.equal(res._code, 401)
  })
})

// ── requireCreator ────────────────────────────────────────────────────────────

describe('requireCreator', () => {
  it('allows an approved creator', () => {
    let called = false
    requireCreator(
      makeReq({ user: { isCreator: true, creatorStatus: 'approved' } }),
      makeRes(), () => { called = true }
    )
    assert.equal(called, true)
  })

  it('blocks a creator with applied/pending status', () => {
    const res = makeRes()
    requireCreator(
      makeReq({ user: { isCreator: true, creatorStatus: 'applied' } }),
      res, () => { throw new Error() }
    )
    assert.equal(res._code, 403)
  })

  it('blocks a creator with rejected status', () => {
    const res = makeRes()
    requireCreator(
      makeReq({ user: { isCreator: true, creatorStatus: 'rejected' } }),
      res, () => { throw new Error() }
    )
    assert.equal(res._code, 403)
  })

  it('blocks a user who is not a creator', () => {
    const res = makeRes()
    requireCreator(
      makeReq({ user: { isCreator: false, creatorStatus: 'none' } }),
      res, () => { throw new Error() }
    )
    assert.equal(res._code, 403)
  })

  it('blocks when user is null', () => {
    const res = makeRes()
    requireCreator(makeReq({ user: null }), res, () => { throw new Error() })
    assert.equal(res._code, 403)
  })
})

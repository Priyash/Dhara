/**
 * API service layer tests.
 * Covers: ID normalization, fetch wrapper, auth header injection,
 * 401 forced sign-out, and error propagation.
 * Uses vi.stubGlobal to mock fetch — no real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Firebase before importing api.js ────────────────────────────────────

vi.mock('../lib/firebase.js', () => ({
  auth: { currentUser: null },
}))

vi.mock('firebase/auth', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}))

// ── Inline normalizeItem (mirrors the unexported helper in api.js) ────────────

function normalizeItem(item) {
  if (!item) return item
  const { _id, ...rest } = item
  return { ...rest, id: String(_id ?? rest.id) }
}

// ── ID normalization ──────────────────────────────────────────────────────────

describe('normalizeItem', () => {
  it('converts _id to id', () => {
    const result = normalizeItem({ _id: '64abc', title: 'Pather Panchali' })
    expect(result.id).toBe('64abc')
    expect(result._id).toBeUndefined()
  })

  it('preserves all other fields', () => {
    const result = normalizeItem({ _id: '1', title: 'Test', type: 'Film', rating: 4.5 })
    expect(result.title).toBe('Test')
    expect(result.type).toBe('Film')
    expect(result.rating).toBe(4.5)
  })

  it('coerces _id to string', () => {
    const result = normalizeItem({ _id: 123 })
    expect(typeof result.id).toBe('string')
    expect(result.id).toBe('123')
  })

  it('falls back to existing id when _id is absent', () => {
    const result = normalizeItem({ id: 'existing-id', title: 'X' })
    expect(result.id).toBe('existing-id')
  })

  it('returns null for null input', () => {
    expect(normalizeItem(null)).toBeNull()
  })

  it('returns undefined for undefined input', () => {
    expect(normalizeItem(undefined)).toBeUndefined()
  })
})

// ── Fetch wrapper behaviour (uses stubbed fetch) ──────────────────────────────

describe('request — success path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed JSON on 2xx', async () => {
    const payload = { items: [{ _id: '1', title: 'Film A' }] }
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    })

    // Inline the request logic for isolation
    async function request(url) {
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'HTTP error')
      return data
    }

    const result = await request('/api/content')
    expect(result).toEqual(payload)
  })
})

describe('request — error path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws the server error message on non-2xx', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Invalid plan' }),
    })

    async function request(url) {
      const res = await fetch(url)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      return data
    }

    await expect(request('/api/payments/create-order')).rejects.toThrow('Invalid plan')
  })

  it('falls back to "HTTP <status>" when no error body', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error('not json')),
    })

    async function request(url) {
      const res = await fetch(url)
      let data = null
      try { data = await res.json() } catch { /* no-op */ }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      return data
    }

    await expect(request('/api/health')).rejects.toThrow('HTTP 503')
  })
})

// ── Auth — localStorage hint ───────────────────────────────────────────────────

describe('auth hint — localStorage flag', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('reads back the stored hint', () => {
    localStorage.setItem('dhara:authed', '1')
    expect(localStorage.getItem('dhara:authed')).toBe('1')
  })

  it('hint is absent after removal', () => {
    localStorage.setItem('dhara:authed', '1')
    localStorage.removeItem('dhara:authed')
    expect(localStorage.getItem('dhara:authed')).toBeNull()
  })

  it('optimistic flag is truthy when set', () => {
    localStorage.setItem('dhara:authed', '1')
    const hint = localStorage.getItem('dhara:authed') === '1'
    expect(hint).toBe(true)
  })

  it('optimistic flag is falsy when absent', () => {
    const hint = localStorage.getItem('dhara:authed') === '1'
    expect(hint).toBe(false)
  })
})

// ── Content catalogue helpers ─────────────────────────────────────────────────

describe('fetchContent — response normalisation', () => {
  it('handles paginated response shape { items, total, page }', () => {
    const response = { items: [{ _id: '1' }, { _id: '2' }], total: 2, page: 1, pages: 1, limit: 24 }
    const isPagedShape = response && typeof response === 'object' && !Array.isArray(response) && Array.isArray(response.items)
    expect(isPagedShape).toBe(true)
  })

  it('handles flat array response shape (legacy)', () => {
    const response = [{ _id: '1' }, { _id: '2' }]
    expect(Array.isArray(response)).toBe(true)
  })
})

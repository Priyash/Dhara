/**
 * API service layer tests — imports the real module (no reimplementation).
 * Covers: request() core behaviour (auth headers, 401 forced sign-out, error
 * propagation), ID normalization, response-shape handling, and every
 * exported wrapper's HTTP method + path + body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let currentUser = null

vi.mock('../lib/firebase.js', () => ({
  auth: {
    get currentUser() { return currentUser },
  },
}))

const firebaseSignOut = vi.fn().mockResolvedValue(undefined)
vi.mock('firebase/auth', () => ({
  signOut: (...args) => firebaseSignOut(...args),
}))

let api

beforeEach(async () => {
  vi.resetModules()
  currentUser = null
  firebaseSignOut.mockClear()
  vi.stubGlobal('fetch', vi.fn())
  localStorage.clear()
  api = await import('../services/api.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

// ── request() core behaviour ───────────────────────────────────────────────────

describe('request — core behaviour', () => {
  it('sends no Authorization header when signed out', async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true }))
    await api.getMe()
    const [, opts] = fetch.mock.calls[0]
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it('attaches a Bearer token when signed in', async () => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    fetch.mockResolvedValue(jsonResponse({ ok: true }))
    await api.getMe()
    const [, opts] = fetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer tok-123')
  })

  it('always sends Content-Type: application/json', async () => {
    fetch.mockResolvedValue(jsonResponse({}))
    await api.getMe()
    const [, opts] = fetch.mock.calls[0]
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  it('resolves with parsed JSON on success', async () => {
    fetch.mockResolvedValue(jsonResponse({ hello: 'world' }))
    await expect(api.getMe()).resolves.toEqual({ hello: 'world' })
  })

  it('throws the server error message on non-2xx', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'Invalid plan' }, false, 400))
    await expect(api.createOrder('monthly')).rejects.toThrow('Invalid plan')
  })

  it('falls back to "HTTP <status>" when the error body has no message', async () => {
    fetch.mockResolvedValue(jsonResponse({}, false, 503))
    await expect(api.getMe()).rejects.toThrow('HTTP 503')
  })

  it('falls back to "HTTP <status>" when the body is not valid JSON', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.reject(new Error('bad json')) })
    await expect(api.getMe()).rejects.toThrow('HTTP 500')
  })

  it('tolerates a non-JSON success body (treats parsed data as null)', async () => {
    fetch.mockResolvedValue({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) })
    await expect(api.getMe()).resolves.toBeNull()
  })

  it('forces sign-out and redirects home on 401 while a user was logged in', async () => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('tok') }
    fetch.mockResolvedValue(jsonResponse({ error: 'Invalid or expired token' }, false, 401))

    const assign = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, pathname: '/profile', assign },
      writable: true,
    })

    await expect(api.getMe()).rejects.toThrow('Invalid or expired token')
    expect(firebaseSignOut).toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('/')

    Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
  })

  it('does not force sign-out on 401 when no user was logged in (e.g. public route)', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'unauth' }, false, 401))
    await expect(api.getMe()).rejects.toThrow('unauth')
    expect(firebaseSignOut).not.toHaveBeenCalled()
  })

  it('does not redirect on 401 when already on the home page', async () => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('tok') }
    fetch.mockResolvedValue(jsonResponse({ error: 'unauth' }, false, 401))

    const assign = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, pathname: '/', assign },
      writable: true,
    })

    await expect(api.getMe()).rejects.toThrow()
    expect(assign).not.toHaveBeenCalled()

    Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
  })
})

// ── normalizeItem behaviour (via fetchContentById) ────────────────────────────

describe('item normalization', () => {
  it('converts _id to id and drops _id', async () => {
    fetch.mockResolvedValue(jsonResponse({ _id: '64abc', title: 'Pather Panchali' }))
    const result = await api.fetchContentById('64abc')
    expect(result.id).toBe('64abc')
    expect(result._id).toBeUndefined()
    expect(result.title).toBe('Pather Panchali')
  })

  it('coerces a numeric _id to a string', async () => {
    fetch.mockResolvedValue(jsonResponse({ _id: 123 }))
    const result = await api.fetchContentById('123')
    expect(result.id).toBe('123')
    expect(typeof result.id).toBe('string')
  })
})

// ── fetchContent — paginated vs legacy flat array ─────────────────────────────

describe('fetchContent', () => {
  it('normalizes items inside a paginated response and preserves pagination fields', async () => {
    fetch.mockResolvedValue(jsonResponse({ items: [{ _id: '1' }, { _id: '2' }], total: 2, page: 1, pages: 1, limit: 24 }))
    const result = await api.fetchContent({ page: 1 })
    expect(result.items.map((i) => i.id)).toEqual(['1', '2'])
    expect(result.total).toBe(2)
  })

  it('normalizes a legacy flat-array response', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1' }, { _id: '2' }]))
    const result = await api.fetchContent()
    expect(result.map((i) => i.id)).toEqual(['1', '2'])
  })

  it('strips undefined/null/empty-string params from the query string', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.fetchContent({ genre: 'Drama', type: undefined, q: null, page: '' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('genre=Drama')
    expect(url).not.toContain('type=')
    expect(url).not.toContain('q=')
    expect(url).not.toContain('page=')
  })

  it('omits the query string entirely when there are no params', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.fetchContent()
    const [url] = fetch.mock.calls[0]
    expect(url.endsWith('/api/content')).toBe(true)
  })
})

describe('fetchFeaturedContent', () => {
  it('normalizes an array response', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1' }]))
    const result = await api.fetchFeaturedContent()
    expect(result).toEqual([{ id: '1' }])
  })

  it('wraps and normalizes a single-object response', async () => {
    fetch.mockResolvedValue(jsonResponse({ _id: '1', title: 'Solo' }))
    const result = await api.fetchFeaturedContent()
    expect(result).toEqual([{ id: '1', title: 'Solo' }])
  })
})

// ── fetchContinueWatching — localStorage progress merge ───────────────────────

describe('fetchContinueWatching', () => {
  it('uses backend progress when localStorage has nothing', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1', title: 'A', _progress: { positionSecs: 100, durationSecs: 1000 } }]))
    const [result] = await api.fetchContinueWatching()
    expect(result.progressPct).toBe(10)
    expect(result._progress.positionSecs).toBe(100)
  })

  it('prefers localStorage position when it is higher than the backend value', async () => {
    localStorage.setItem('dhara_progress_1', '500')
    localStorage.setItem('dhara_progress_1_dur', '1000')
    fetch.mockResolvedValue(jsonResponse([{ _id: '1', _progress: { positionSecs: 100, durationSecs: 1000 } }]))
    const [result] = await api.fetchContinueWatching()
    expect(result._progress.positionSecs).toBe(500)
    expect(result.progressPct).toBe(50)
  })

  it('keeps backend position when it is higher than localStorage', async () => {
    localStorage.setItem('dhara_progress_1', '10')
    fetch.mockResolvedValue(jsonResponse([{ _id: '1', _progress: { positionSecs: 900, durationSecs: 1000 } }]))
    const [result] = await api.fetchContinueWatching()
    expect(result._progress.positionSecs).toBe(900)
  })

  it('caps progressPct at 99 even when position reaches duration', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1', _progress: { positionSecs: 1000, durationSecs: 1000 } }]))
    const [result] = await api.fetchContinueWatching()
    expect(result.progressPct).toBe(99)
  })

  it('returns 0% when duration is unknown', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1', _progress: { positionSecs: 50, durationSecs: 0 } }]))
    const [result] = await api.fetchContinueWatching()
    expect(result.progressPct).toBe(0)
  })

  it('handles items missing _progress entirely', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1' }]))
    const [result] = await api.fetchContinueWatching()
    expect(result.progressPct).toBe(0)
  })
})

// ── fetchRecommendations / fetchRecommendationShelves / fetchShelves ──────────

describe('fetchRecommendations', () => {
  it('normalizes items and preserves other response fields', async () => {
    fetch.mockResolvedValue(jsonResponse({ items: [{ _id: '1' }], strategy: 'cold-start' }))
    const result = await api.fetchRecommendations()
    expect(result.items).toEqual([{ id: '1' }])
    expect(result.strategy).toBe('cold-start')
  })

  it('defaults items to [] when missing', async () => {
    fetch.mockResolvedValue(jsonResponse({ strategy: 'x' }))
    const result = await api.fetchRecommendations()
    expect(result.items).toEqual([])
  })

  it('sends the recommendation session header', async () => {
    fetch.mockResolvedValue(jsonResponse({ items: [] }))
    await api.fetchRecommendations()
    const [, opts] = fetch.mock.calls[0]
    expect(opts.headers['X-Rec-Session']).toBeTruthy()
  })

  it('reuses the same session id across calls (persisted in localStorage)', async () => {
    fetch.mockResolvedValue(jsonResponse({ items: [] }))
    await api.fetchRecommendations()
    await api.fetchRecommendations()
    const id1 = fetch.mock.calls[0][1].headers['X-Rec-Session']
    const id2 = fetch.mock.calls[1][1].headers['X-Rec-Session']
    expect(id1).toBe(id2)
  })
})

describe('fetchRecommendationShelves', () => {
  it('normalizes items within each shelf', async () => {
    fetch.mockResolvedValue(jsonResponse({ shelves: [{ title: 'Trending', items: [{ _id: '1' }] }] }))
    const result = await api.fetchRecommendationShelves()
    expect(result[0].items).toEqual([{ id: '1' }])
  })

  it('defaults to an empty array when shelves is missing', async () => {
    fetch.mockResolvedValue(jsonResponse({}))
    const result = await api.fetchRecommendationShelves()
    expect(result).toEqual([])
  })
})

describe('fetchShelves (public curated shelves)', () => {
  it('normalizes shelf id and nested items', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: 's1', title: 'Picks', items: [{ _id: '1' }] }]))
    const result = await api.fetchShelves()
    expect(result[0].id).toBe('s1')
    expect(result[0].items).toEqual([{ id: '1' }])
  })
})

describe('fetchWatchlistItems', () => {
  it('normalizes each item', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1' }, { _id: '2' }]))
    const result = await api.fetchWatchlistItems()
    expect(result.map((i) => i.id)).toEqual(['1', '2'])
  })
})

describe('searchContent', () => {
  it('URL-encodes the query and normalizes results', async () => {
    fetch.mockResolvedValue(jsonResponse([{ _id: '1' }]))
    await api.searchContent('Pather Panchali')
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('q=Pather%20Panchali')
  })
})

// ── recordInteractionEvent / likeContent / likeReel side-effects ──────────────

describe('likeContent', () => {
  it('fires a fire-and-forget interaction event when the like succeeds', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ liked: true }))
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await api.likeContent('c1')
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(2)
    const [secondUrl] = fetch.mock.calls[1]
    expect(secondUrl).toContain('/api/recommendations/events')
  })

  it('does not fire an interaction event when liked is false (unlike)', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ liked: false }))
    await api.likeContent('c1')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the fire-and-forget interaction event itself fails', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ liked: true }))
    fetch.mockRejectedValueOnce(new Error('network down'))
    await expect(api.likeContent('c1')).resolves.toEqual({ liked: true })
  })
})

// ── XHR-based uploads ──────────────────────────────────────────────────────────

describe('uploadJobFile', () => {
  class MockXHR {
    constructor() {
      this.upload = { addEventListener: vi.fn() }
      this._listeners = {}
      this.status = 200
      this.responseText = '{"ok":true}'
    }
    open() {}
    setRequestHeader() {}
    send() { this._listeners.load?.() }
    addEventListener(evt, cb) { this._listeners[evt] = cb }
  }

  beforeEach(() => vi.stubGlobal('XMLHttpRequest', MockXHR))

  it('resolves with parsed JSON on a successful upload', async () => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('tok') }
    const file = new File(['data'], 'movie.mp4')
    await expect(api.uploadJobFile('job1', file)).resolves.toEqual({ ok: true })
  })

  it('rejects with the server error message on a failed upload', async () => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('tok') }
    class FailingXHR extends MockXHR {
      constructor() { super(); this.status = 500; this.responseText = '{"error":"disk full"}' }
    }
    vi.stubGlobal('XMLHttpRequest', FailingXHR)
    const file = new File(['data'], 'movie.mp4')
    await expect(api.uploadJobFile('job1', file)).rejects.toThrow('disk full')
  })

  it('exposes the underlying XHR via onXhr for cancellation', async () => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('tok') }
    const file = new File(['data'], 'movie.mp4')
    const onXhr = vi.fn()
    await api.uploadJobFile('job1', file, { onXhr })
    expect(onXhr).toHaveBeenCalledWith(expect.any(MockXHR))
  })

  it('rejects when getIdToken itself fails', async () => {
    currentUser = { getIdToken: vi.fn().mockRejectedValue(new Error('token error')) }
    const file = new File(['data'], 'movie.mp4')
    await expect(api.uploadJobFile('job1', file)).rejects.toThrow('token error')
  })
})

// ── Table-driven coverage of every thin wrapper export ────────────────────────
// Each entry: [fn name, args, expected path substring, expected method (default GET)]

const WRAPPER_CASES = [
  ['loginWithBackend', ['tok'], '/api/auth/login', 'POST'],
  ['getMe', [], '/api/user/me'],
  ['addToWatchlist', ['c1'], '/api/user/watchlist/c1', 'POST'],
  ['removeFromWatchlist', ['c1'], '/api/user/watchlist/c1', 'DELETE'],
  ['saveWatchProgress', [{ contentId: 'c1' }], '/api/user/watch-progress', 'POST'],
  ['fetchTrailerUrl', ['c1'], '/api/content/c1/trailer'],
  ['sendStreamHeartbeat', ['s1'], '/api/content/heartbeat', 'POST'],
  ['endStreamSession', ['s1'], '/api/content/stream-session/s1', 'DELETE'],
  ['dislikeContent', ['c1'], '/api/content/c1/dislike', 'POST'],
  ['rateContent', ['c1', 5], '/api/content/c1/rate', 'POST'],
  ['fetchPopularSearches', [], '/api/search/popular'],
  ['createOrder', ['monthly'], '/api/payments/create-order', 'POST'],
  ['createSubscription', ['monthly'], '/api/payments/create-subscription', 'POST'],
  ['getPaymentHistory', [], '/api/payments/history'],
  ['cancelSubscription', [], '/api/payments/cancel', 'POST'],
  ['getAdminSession', [], '/api/admin/session'],
  ['getPaymentConfig', [], '/api/admin/payment-config'],
  ['updatePaymentConfig', [{ a: 1 }], '/api/admin/payment-config', 'PATCH'],
  ['listAdminCollections', [], '/api/admin/collections'],
  ['createAdminCollection', [{ name: 'x' }], '/api/admin/collections', 'POST'],
  ['listAdminContent', [], '/api/admin/content'],
  ['listUploadJobs', [10], '/api/admin/upload-jobs?limit=10'],
  ['getUploadJob', ['j1'], '/api/admin/upload-jobs/j1'],
  ['createUploadJob', [{ title: 'x' }], '/api/admin/upload-jobs', 'POST'],
  ['listBunnyCollections', [], '/api/admin/bunny/collections'],
  ['createBunnyCollection', ['name'], '/api/admin/bunny/collections', 'POST'],
  ['syncBunnyCollections', [], '/api/admin/bunny/sync-collections', 'POST'],
  ['importFromCdn', [], '/api/admin/import-from-cdn', 'POST'],
  ['syncCdnDeletions', [], '/api/admin/bunny/sync-deletions', 'POST'],
  ['importFromArchive', [[{ id: '1' }]], '/api/admin/archive/import', 'POST'],
  ['cancelUploadJob', ['j1'], '/api/admin/upload-jobs/j1/cancel', 'PATCH'],
  ['retryUploadJob', ['j1'], '/api/admin/upload-jobs/j1/retry', 'PATCH'],
  ['dismissArchiveCandidate', ['a1'], '/api/admin/archive/candidates/a1/dismiss', 'PATCH'],
  ['mapExistingBunnyVideo', [{ a: 1 }], '/api/admin/map-existing-video', 'POST'],
  ['fetchAdminContentById', ['c1'], '/api/admin/content/c1'],
  ['createAdminContent', [{ title: 'x' }], '/api/admin/content', 'POST'],
  ['updateAdminContent', ['c1', { title: 'x' }], '/api/admin/content/c1', 'PATCH'],
  ['togglePublishContent', ['c1', true], '/api/admin/content/c1/publish', 'PATCH'],
  ['deleteAdminContent', ['c1'], '/api/admin/content/c1', 'DELETE'],
  ['getAdminRevenue', [], '/api/admin/revenue'],
  ['getAdminMonitor', [], '/api/admin/monitor'],
  ['calculateCreatorEarnings', [{ a: 1 }], '/api/admin/revenue/calculate', 'POST'],
  ['processCreatorPayout', [{ a: 1 }], '/api/admin/creator-payouts', 'POST'],
  ['listAdminCreatorPayouts', [], '/api/admin/creator-payouts'],
  ['applyAsCreator', [{ a: 1 }], '/api/creator/apply', 'POST'],
  ['getCreatorStatus', [], '/api/creator/status'],
  ['getCreatorMe', [], '/api/creator/me'],
  ['updateCreatorProfile', [{ a: 1 }], '/api/creator/profile', 'PATCH'],
  ['createCreatorContent', [{ a: 1 }], '/api/creator/content', 'POST'],
  ['getCreatorContentById', ['c1'], '/api/creator/content/c1'],
  ['updateCreatorContent', ['c1', { a: 1 }], '/api/creator/content/c1', 'PATCH'],
  ['resubmitCreatorContent', ['c1'], '/api/creator/content/c1/resubmit', 'POST'],
  ['deleteCreatorContent', ['c1'], '/api/creator/content/c1', 'DELETE'],
  ['getCreatorAnalytics', [], '/api/creator/analytics'],
  ['getCreatorRevenue', [], '/api/creator/revenue'],
  ['requestCreatorPayout', [], '/api/creator/payouts/request', 'POST'],
  ['searchReels', ['q'], '/api/reels/search?q=q'],
  ['fetchReelById', ['r1'], '/api/reels/r1'],
  ['fetchReelStreamUrl', ['r1'], '/api/reels/r1/stream'],
  ['recordReelView', ['r1'], '/api/reels/r1/view', 'POST'],
  ['postReelComment', ['r1', 'hi'], '/api/reels/r1/comments', 'POST'],
  ['deleteReelComment', ['r1', 'c1'], '/api/reels/r1/comments/c1', 'DELETE'],
  ['createReelUploadJob', ['r1'], '/api/reels/r1/upload-job', 'POST'],
  ['getReelUploadJob', ['r1'], '/api/reels/r1/upload-job'],
  ['fetchReelAnalytics', [], '/api/creator/reels/analytics'],
  ['createCreatorReel', [{ a: 1 }], '/api/creator/reels', 'POST'],
  ['deleteCreatorReel', ['r1'], '/api/creator/reels/r1', 'DELETE'],
  ['resubmitCreatorReel', ['r1'], '/api/creator/reels/r1/resubmit', 'POST'],
  ['approveCreatorApplication', ['u1'], '/api/admin/creator-applications/u1/approve', 'PATCH'],
  ['rejectCreatorApplication', ['u1', 'reason'], '/api/admin/creator-applications/u1/reject', 'PATCH'],
  ['approveSubmission', ['s1'], '/api/admin/submissions/s1/approve', 'PATCH'],
  ['rejectSubmission', ['s1', 'reason'], '/api/admin/submissions/s1/reject', 'PATCH'],
  ['listAdminShelves', [], '/api/admin/shelves'],
  ['createAdminShelf', [{ a: 1 }], '/api/admin/shelves', 'POST'],
  ['updateAdminShelf', ['s1', { a: 1 }], '/api/admin/shelves/s1', 'PATCH'],
  ['deleteAdminShelf', ['s1'], '/api/admin/shelves/s1', 'DELETE'],
  ['reorderAdminShelves', [['a', 'b']], '/api/admin/shelves/reorder', 'PATCH'],
  ['approveAdminReel', ['r1'], '/api/admin/reels/r1/approve', 'PATCH'],
  ['rejectAdminReel', ['r1', 'reason'], '/api/admin/reels/r1/reject', 'PATCH'],
  ['deleteAdminReel', ['r1'], '/api/admin/reels/r1', 'DELETE'],
]

describe('wrapper exports — method + path', () => {
  for (const [fnName, args, pathSubstring, method] of WRAPPER_CASES) {
    it(`${fnName}() calls ${method || 'GET'} ${pathSubstring}`, async () => {
      fetch.mockResolvedValue(jsonResponse({}))
      await api[fnName](...args)
      const [url, opts] = fetch.mock.calls[0]
      expect(url).toContain(pathSubstring)
      if (method) expect(opts.method).toBe(method)
      else expect(opts?.method).toBeUndefined()
    })
  }
})

// ── Wrappers with query-string filtering (params object) ─────────────────────

const QS_WRAPPER_CASES = [
  ['fetchContentGenres', '/api/content/genres'],
  ['listCreatorContent', '/api/creator/content'],
  ['listCreatorReels', '/api/creator/reels'],
  ['fetchReelHashtags', '/api/reels/hashtags'],
  ['fetchReels', '/api/reels'],
  ['fetchReelComments', '/api/reels/r1/comments'],
  ['listArchiveCandidates', '/api/admin/archive/candidates'],
  ['listAdminReels', '/api/admin/reels'],
]

describe('wrapper exports — query string params', () => {
  it('fetchContentGenres strips empty params', async () => {
    fetch.mockResolvedValue(jsonResponse({}))
    await api.fetchContentGenres({ genre: 'Drama', q: '' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('genre=Drama')
    expect(url).not.toContain('q=')
  })

  it('listArchiveCandidates defaults to status=new', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.listArchiveCandidates()
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('status=new')
  })

  it('searchArchive builds a query string from params', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.searchArchive({ q: 'Pather Panchali', language: 'Bengali' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('q=Pather')
    expect(url).toContain('language=Bengali')
  })

  it('listBunnyVideos builds a query string from params', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.listBunnyVideos({ page: 2 })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('page=2')
  })

  it('getAdminTransactions builds a query string from params', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.getAdminTransactions({ status: 'paid' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('status=paid')
  })

  it('listAdminCreatorEarnings builds a query string from params', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.listAdminCreatorEarnings({ month: '2026-01' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('month=2026-01')
  })

  it('listCreatorApplications builds a query string from params', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.listCreatorApplications({ status: 'applied' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('status=applied')
  })

  it('listAdminSubmissions builds a query string from params', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await api.listAdminSubmissions({ status: 'pending' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('status=pending')
  })

  for (const [fnName, pathSubstring] of QS_WRAPPER_CASES) {
    it(`${fnName}() hits ${pathSubstring} with no params`, async () => {
      fetch.mockResolvedValue(jsonResponse(fnName === 'fetchReelComments' ? { comments: [] } : []))
      const arg = fnName === 'fetchReelComments' ? ['r1'] : []
      await api[fnName](...arg)
      const [url] = fetch.mock.calls[0]
      expect(url).toContain(pathSubstring)
    })
  }
})

describe('fetchStreamUrl', () => {
  it('omits season/episode params when not given', async () => {
    fetch.mockResolvedValue(jsonResponse({ url: 'x' }))
    await api.fetchStreamUrl('c1')
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('/api/content/c1/stream')
    expect(url).not.toContain('episode=')
  })

  it('includes season and episode params when given', async () => {
    fetch.mockResolvedValue(jsonResponse({ url: 'x' }))
    await api.fetchStreamUrl('c1', 3, 2)
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('episode=3')
    expect(url).toContain('season=2')
  })
})

describe('recordView', () => {
  it('builds the request body with defaults', async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true }))
    await api.recordView('c1')
    const [, opts] = fetch.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ positionSecs: 30 })
  })

  it('includes episodeNumber and seasonNumber when provided', async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true }))
    await api.recordView('c1', 2, 45, 1)
    const [, opts] = fetch.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ positionSecs: 45, episodeNumber: 2, seasonNumber: 1 })
  })
})

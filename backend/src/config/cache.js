/**
 * TTL cache for API response caching, used by withCache().
 *
 * Backed by Redis (via REDIS_URL) when configured — required once you run
 * more than one backend instance, since each instance otherwise has its own
 * disconnected cache. Falls back to an in-memory store when REDIS_URL is
 * unset (local dev, or a single-instance deploy).
 *
 *   cache.get(key)              → Promise<value | null>
 *   cache.set(key, val, ttlMs)  → Promise<void>
 *   cache.deleteByPrefix(str)   → Promise<void>
 *   withCache(ttlSec)           → Express middleware
 *
 * Cache errors never break a request — both backends log and degrade to a
 * miss/no-op rather than rejecting, since caching is a pure optimization.
 */
import { redisClient } from './redis.js'

const KEY_PREFIX = 'dhara:cache:'

const TTL_CACHE_MAX = 5_000  // max entries before LRU eviction kicks in

class TTLCache {
  constructor() {
    this._store = new Map()
    setInterval(() => this._evict(), 60_000).unref()
  }

  async get(key) {
    const entry = this._store.get(key)
    if (!entry) return null
    if (Date.now() > entry.exp) { this._store.delete(key); return null }
    // Refresh insertion order (LRU: move to end on access)
    this._store.delete(key)
    this._store.set(key, entry)
    return entry.val
  }

  async set(key, val, ttlMs) {
    // Delete first so re-insertion moves to end (LRU ordering)
    this._store.delete(key)
    this._store.set(key, { val, exp: Date.now() + ttlMs })
    if (this._store.size > TTL_CACHE_MAX) {
      // Evict the oldest entry (first in Map insertion order)
      this._store.delete(this._store.keys().next().value)
    }
  }

  async deleteByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key)
    }
  }

  async clear() { this._store.clear() }

  _evict() {
    const now = Date.now()
    for (const [key, entry] of this._store) {
      if (now > entry.exp) this._store.delete(key)
    }
    // If still over limit after TTL sweep, evict oldest entries
    while (this._store.size > TTL_CACHE_MAX) {
      this._store.delete(this._store.keys().next().value)
    }
  }
}

class RedisCache {
  constructor(client) {
    this._client = client
  }

  async get(key) {
    try {
      const raw = await this._client.get(KEY_PREFIX + key)
      return raw == null ? null : JSON.parse(raw)
    } catch (err) {
      console.error('[cache] redis get failed, treating as miss:', err.message)
      return null
    }
  }

  async set(key, val, ttlMs) {
    try {
      await this._client.set(KEY_PREFIX + key, JSON.stringify(val), 'PX', ttlMs)
    } catch (err) {
      console.error('[cache] redis set failed:', err.message)
    }
  }

  async deleteByPrefix(prefix) {
    try {
      await this._deleteByMatch(`${KEY_PREFIX}${prefix}*`)
    } catch (err) {
      console.error('[cache] redis deleteByPrefix failed:', err.message)
    }
  }

  async clear() {
    try {
      await this._deleteByMatch(`${KEY_PREFIX}*`)
    } catch (err) {
      console.error('[cache] redis clear failed:', err.message)
    }
  }

  // SCAN (not KEYS) to avoid blocking Redis on a large keyspace
  async _deleteByMatch(pattern) {
    const stream = this._client.scanStream({ match: pattern, count: 100 })
    const pipeline = this._client.pipeline()
    let queued = 0
    for await (const keys of stream) {
      if (keys.length) {
        keys.forEach((k) => pipeline.del(k))
        queued += keys.length
      }
    }
    if (queued) await pipeline.exec()
  }
}

export const cache = redisClient ? new RedisCache(redisClient) : new TTLCache()

if (!redisClient && process.env.NODE_ENV === 'production') {
  console.warn('[cache] WARNING — REDIS_URL not set. In-memory cache is per-instance and capped at 5K entries. Rate limiting will NOT be shared across instances. Set REDIS_URL before scaling to 2+ instances.')
}

// Singleflight: prevents thundering herd by coalescing concurrent cache misses on
// the same key. The first miss triggers the handler; concurrent misses wait for it.
const _inFlight = new Map()

/**
 * Express middleware factory — caches successful GET responses.
 *
 * Usage:
 *   router.get('/path', withCache(60), myHandler)
 *
 * Adds X-Cache: HIT | MISS header so you can verify in devtools.
 * Sets Cache-Control: public, max-age=<ttl> on cached responses so
 * Vercel's CDN / browser can also cache them at the edge.
 */
export function withCache(ttlSeconds) {
  const ttlMs = ttlSeconds * 1000
  return (req, res, next) => {
    if (req.method !== 'GET') return next()

    const key = req.originalUrl

    cache.get(key).then((hit) => {
      if (hit !== null) {
        res.setHeader('X-Cache',       'HIT')
        res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`)
        return res.json(hit)
      }

      // Singleflight: if another request is already computing this key, wait for it
      if (_inFlight.has(key)) {
        return _inFlight.get(key).then((data) => {
          res.setHeader('X-Cache',       'HIT')
          res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`)
          return res.json(data)
        }).catch(next)
      }

      // Intercept res.json so we capture the response before it's sent
      let resolveInflight, rejectInflight
      const inflight = new Promise((res, rej) => { resolveInflight = res; rejectInflight = rej })
      _inFlight.set(key, inflight)

      const originalJson = res.json.bind(res)
      res.json = (data) => {
        if (res.statusCode === 200) {
          cache.set(key, data, ttlMs)
          res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`)
          resolveInflight(data)
        } else {
          rejectInflight(new Error(`non-200 status ${res.statusCode}`))
        }
        _inFlight.delete(key)
        res.setHeader('X-Cache', 'MISS')
        return originalJson(data)
      }

      // Clean up inflight entry if the handler throws
      const origNext = next
      next = (err) => { _inFlight.delete(key); rejectInflight(err || new Error('handler error')); origNext(err) }

      next()
    }).catch(next)
  }
}

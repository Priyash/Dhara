/**
 * Lightweight in-memory TTL cache for API response caching.
 *
 * Designed to be a drop-in for a Redis client later:
 *   cache.get(key)              → value | null
 *   cache.set(key, val, ttlMs)
 *   cache.deleteByPrefix(str)
 *   withCache(ttlSec)           → Express middleware
 *
 * A background interval evicts expired entries every 60 s to prevent
 * unbounded memory growth. The entire store is intentionally process-local —
 * each instance has its own copy, which is fine for a single-instance deploy.
 * Replace the TTLCache implementation with an Upstash Redis client when
 * running multiple instances behind a load balancer.
 */

class TTLCache {
  constructor() {
    this._store = new Map()
    // Periodic eviction — prevents unbounded growth without needing an LRU library
    setInterval(() => this._evict(), 60_000).unref()
  }

  get(key) {
    const entry = this._store.get(key)
    if (!entry) return null
    if (Date.now() > entry.exp) { this._store.delete(key); return null }
    return entry.val
  }

  set(key, val, ttlMs) {
    this._store.set(key, { val, exp: Date.now() + ttlMs })
  }

  deleteByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key)
    }
  }

  clear() { this._store.clear() }

  get size() { return this._store.size }

  _evict() {
    const now = Date.now()
    for (const [key, entry] of this._store) {
      if (now > entry.exp) this._store.delete(key)
    }
  }
}

export const cache = new TTLCache()

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
    const hit = cache.get(key)
    if (hit !== null) {
      res.setHeader('X-Cache',       'HIT')
      res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`)
      return res.json(hit)
    }

    // Intercept res.json so we capture the response before it's sent
    const originalJson = res.json.bind(res)
    res.json = (data) => {
      if (res.statusCode === 200) {
        cache.set(key, data, ttlMs)
        res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`)
      }
      res.setHeader('X-Cache', 'MISS')
      return originalJson(data)
    }

    next()
  }
}

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

class TTLCache {
  constructor() {
    this._store = new Map()
    // Periodic eviction — prevents unbounded growth without needing an LRU library
    setInterval(() => this._evict(), 60_000).unref()
  }

  async get(key) {
    const entry = this._store.get(key)
    if (!entry) return null
    if (Date.now() > entry.exp) { this._store.delete(key); return null }
    return entry.val
  }

  async set(key, val, ttlMs) {
    this._store.set(key, { val, exp: Date.now() + ttlMs })
  }

  async deleteByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key)
    }
  }

  async clear() { this._store.clear() }
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
    }).catch(next)
  }
}

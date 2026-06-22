/**
 * Shared Redis connection — backs the response cache (cache.js) and the
 * rate limiters (server.js) so they work correctly across multiple instances.
 *
 * Optional: with REDIS_URL unset, redisClient is null and both call sites
 * fall back to process-local in-memory storage (fine for a single instance,
 * e.g. local dev or the current single-instance Render deploy).
 */
import Redis from 'ioredis'

const url = process.env.REDIS_URL

export const redisClient = url
  ? new Redis(url, {
      maxRetriesPerRequest: 2,
      // Don't let a slow/unreachable Redis hold up app startup — connect lazily
      // and let individual commands fail fast (callers already handle errors).
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    })
  : null

if (redisClient) {
  redisClient.on('connect', () => console.log('[redis] connected'))
  redisClient.on('error', (err) => console.error('[redis] error:', err.message))
}

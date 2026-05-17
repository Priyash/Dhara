import { createHash } from 'crypto'

/**
 * Builds a Bunny CDN HLS URL.
 * Reels are always signed — they require auth to watch but have no subscription gate.
 *
 * Token formula matches the Bunny Token Auth spec:
 *   token = base64url( SHA256( TokenAuthKey + urlPath + expires ) )
 */
export function buildHlsUrl(videoId) {
  const pullZone = process.env.BUNNY_CDN_PULL_ZONE
  const path     = `/${videoId}/playlist.m3u8`
  const base     = `https://${pullZone}${path}`

  const expires = Math.floor(Date.now() / 1000) + 3600
  const key     = process.env.BUNNY_CDN_TOKEN_AUTH_KEY || ''

  if (!key) return base  // dev fallback — unsigned

  const token = createHash('sha256')
    .update(key + path + expires)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return `${base}?token=${token}&expires=${expires}`
}

import { createRequire } from 'module'

const _require = createRequire(import.meta.url)
const geoip = _require('geoip-lite')

/** Resolves the ISO country code for a request's IP, or null if it can't be determined. */
export function countryForRequest(req) {
  const rawIp = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || ''
  const geo = geoip.lookup(rawIp) || {}
  return geo.country || null
}

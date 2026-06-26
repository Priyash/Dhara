import { useState, useEffect } from 'react'
import { getLocale } from '../services/api'

let cached = null     // module-level cache — locale doesn't change within a session
let inflight = null

/**
 * Detects the visitor's country and returns an approximate local-currency
 * hint for displaying alongside INR prices. Billing always stays in INR;
 * `currency` is null for Indian/unmapped/unconfigured visitors, in which
 * case callers should just show the INR price alone.
 */
export function useLocale() {
  const [locale, setLocale] = useState(cached)

  useEffect(() => {
    if (cached) return
    inflight = inflight || getLocale().catch(() => ({ countryCode: null, currency: null }))
    inflight.then((res) => {
      cached = res
      setLocale(res)
    })
  }, [])

  return locale || { countryCode: null, currency: null }
}

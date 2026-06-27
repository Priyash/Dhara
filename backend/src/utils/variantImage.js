/**
 * variantImage.js — validates artwork-variant image URLs.
 *
 * A `live` variant's image is served as an <img> to every viewer on the browse
 * rails, so an arbitrary external URL is a privacy (viewer-IP tracking pixel)
 * and moderation risk — especially for creator-supplied URLs. We therefore
 * restrict variant images to a host allowlist:
 *   - res.cloudinary.com  (all Cloudinary delivery URLs; our uploads land here)
 *   - the configured Bunny CDN pull zone
 *   - any hosts in ARTWORK_IMAGE_HOST_ALLOWLIST (comma-separated), for escape hatches
 * and require https. The frontend modal uploads to Cloudinary to produce an
 * allowed URL, so the normal flow is unaffected.
 */

/** The set of allowed image hostnames, derived from env at call time. */
export function allowedImageHosts() {
  const hosts = new Set(['res.cloudinary.com'])
  if (process.env.BUNNY_CDN_PULL_ZONE) hosts.add(process.env.BUNNY_CDN_PULL_ZONE.trim().toLowerCase())
  const extra = process.env.ARTWORK_IMAGE_HOST_ALLOWLIST
  if (extra) {
    extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((h) => hosts.add(h))
  }
  return hosts
}

/**
 * Validates a candidate variant image URL.
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function validateVariantImageUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return { ok: false, error: 'A valid image URL is required' }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'A valid image URL is required' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Image URL must use https' }
  }

  const hosts = allowedImageHosts()
  const host  = parsed.hostname.toLowerCase()
  const allowed = [...hosts].some((h) => host === h || host.endsWith(`.${h}`))
  if (!allowed) {
    return { ok: false, error: `Image host not allowed — upload the image, or use one of: ${[...hosts].join(', ')}` }
  }

  return { ok: true, url }
}

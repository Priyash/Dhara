/**
 * variant image-URL allowlist tests. Pure validator — no DB/network.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { validateVariantImageUrl } from '../src/utils/variantImage.js'

describe('validateVariantImageUrl', () => {
  let prevZone, prevExtra
  beforeEach(() => {
    prevZone  = process.env.BUNNY_CDN_PULL_ZONE
    prevExtra = process.env.ARTWORK_IMAGE_HOST_ALLOWLIST
    process.env.BUNNY_CDN_PULL_ZONE = 'dhara.b-cdn.net'
    delete process.env.ARTWORK_IMAGE_HOST_ALLOWLIST
  })
  afterEach(() => {
    if (prevZone === undefined) delete process.env.BUNNY_CDN_PULL_ZONE; else process.env.BUNNY_CDN_PULL_ZONE = prevZone
    if (prevExtra === undefined) delete process.env.ARTWORK_IMAGE_HOST_ALLOWLIST; else process.env.ARTWORK_IMAGE_HOST_ALLOWLIST = prevExtra
  })

  it('accepts a Cloudinary delivery URL', () => {
    const r = validateVariantImageUrl('https://res.cloudinary.com/dhara/image/upload/v1/x.jpg')
    assert.equal(r.ok, true)
  })

  it('accepts the configured Bunny pull zone', () => {
    assert.equal(validateVariantImageUrl('https://dhara.b-cdn.net/abc/thumbnail.jpg').ok, true)
  })

  it('rejects an arbitrary external host', () => {
    const r = validateVariantImageUrl('https://evil-tracker.example.com/pixel.jpg')
    assert.equal(r.ok, false)
    assert.match(r.error, /not allowed/)
  })

  it('rejects non-https URLs', () => {
    const r = validateVariantImageUrl('http://res.cloudinary.com/dhara/image/upload/x.jpg')
    assert.equal(r.ok, false)
    assert.match(r.error, /https/)
  })

  it('rejects empty / malformed input', () => {
    assert.equal(validateVariantImageUrl('').ok, false)
    assert.equal(validateVariantImageUrl('not a url').ok, false)
    assert.equal(validateVariantImageUrl(null).ok, false)
  })

  it('honours ARTWORK_IMAGE_HOST_ALLOWLIST extra hosts', () => {
    process.env.ARTWORK_IMAGE_HOST_ALLOWLIST = 'cdn.partner.com'
    assert.equal(validateVariantImageUrl('https://cdn.partner.com/a.jpg').ok, true)
  })
})

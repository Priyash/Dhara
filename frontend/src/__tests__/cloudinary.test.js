import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cloudinaryTransform } from '../services/cloudinary.js'

describe('cloudinaryTransform', () => {
  it('inserts transforms after /upload/', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg'
    const result = cloudinaryTransform(url, 'w_400,h_600,c_fill')
    expect(result).toBe('https://res.cloudinary.com/demo/image/upload/w_400,h_600,c_fill/v1/sample.jpg')
  })

  it('returns the url unchanged when it has no /upload/ segment', () => {
    const url = 'https://example.com/not-cloudinary.jpg'
    expect(cloudinaryTransform(url, 'w_400')).toBe(url)
  })

  it('returns falsy input unchanged', () => {
    expect(cloudinaryTransform('', 'w_400')).toBe('')
    expect(cloudinaryTransform(null, 'w_400')).toBeNull()
    expect(cloudinaryTransform(undefined, 'w_400')).toBeUndefined()
  })
})

describe('uploadToCloudinary', () => {
  let xhrInstances

  class MockXHR {
    constructor() {
      this.upload = { onprogress: null }
      this.status = 200
      this.responseText = '{}'
      xhrInstances.push(this)
    }
    open() {}
    send() { this._sent = true }
    setRequestHeader() {}
  }

  beforeEach(() => {
    xhrInstances = []
    vi.stubGlobal('XMLHttpRequest', MockXHR)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('throws when Cloudinary env vars are missing', async () => {
    const { uploadToCloudinary } = await import('../services/cloudinary.js')
    const file = new File(['data'], 'poster.jpg', { type: 'image/jpeg' })
    await expect(uploadToCloudinary(file)).rejects.toThrow(/VITE_CLOUDINARY/)
  })
})

/**
 * Frame-extraction pure-logic tests. Exercises the deterministic helpers
 * (evenTimestamps, buildBunnyMp4Url) and the dormant-by-default gating
 * (isExtractionConfigured) without invoking ffmpeg, Cloudinary, Bunny, or any
 * DB — none of which exist in the test environment. This is exactly the surface
 * that must stay correct while the feature sits dormant.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evenTimestamps, buildBunnyMp4Url, isExtractionConfigured } from '../src/services/frameExtraction.js'

describe('evenTimestamps', () => {
  it('returns [] for an invalid/zero duration', () => {
    assert.deepEqual(evenTimestamps(0, 8), [])
    assert.deepEqual(evenTimestamps(-5, 8), [])
    assert.deepEqual(evenTimestamps('nope', 8), [])
  })

  it('samples the middle for a single frame', () => {
    assert.deepEqual(evenTimestamps(1000, 1), [500])
  })

  it('spaces evenly across the middle 80% (skips intro/credits)', () => {
    assert.deepEqual(evenTimestamps(1000, 5), [100, 300, 500, 700, 900])
  })

  it('never samples the first or last 10%', () => {
    const ts = evenTimestamps(1000, 8)
    assert.ok(Math.min(...ts) >= 100)
    assert.ok(Math.max(...ts) <= 900)
  })

  it('clamps the count to a sane maximum', () => {
    assert.equal(evenTimestamps(1000, 9999).length, 20)
  })

  it('treats a non-positive count as one frame', () => {
    assert.deepEqual(evenTimestamps(1000, 0), [500])
  })
})

describe('buildBunnyMp4Url', () => {
  it('returns null when the CDN pull zone is not configured', () => {
    const prev = process.env.BUNNY_CDN_PULL_ZONE
    delete process.env.BUNNY_CDN_PULL_ZONE
    assert.equal(buildBunnyMp4Url('abc'), null)
    if (prev !== undefined) process.env.BUNNY_CDN_PULL_ZONE = prev
  })

  it('returns null when the video id is missing', () => {
    const prev = process.env.BUNNY_CDN_PULL_ZONE
    process.env.BUNNY_CDN_PULL_ZONE = 'cdn.example.net'
    assert.equal(buildBunnyMp4Url(''), null)
    if (prev === undefined) delete process.env.BUNNY_CDN_PULL_ZONE
    else process.env.BUNNY_CDN_PULL_ZONE = prev
  })

  it('builds the MP4-fallback URL with the default resolution', () => {
    const prevZone = process.env.BUNNY_CDN_PULL_ZONE
    const prevRes  = process.env.BUNNY_STREAM_MP4_RESOLUTION
    process.env.BUNNY_CDN_PULL_ZONE = 'cdn.example.net'
    delete process.env.BUNNY_STREAM_MP4_RESOLUTION
    assert.equal(buildBunnyMp4Url('guid-1'), 'https://cdn.example.net/guid-1/play_720p.mp4')
    if (prevZone === undefined) delete process.env.BUNNY_CDN_PULL_ZONE; else process.env.BUNNY_CDN_PULL_ZONE = prevZone
    if (prevRes !== undefined) process.env.BUNNY_STREAM_MP4_RESOLUTION = prevRes
  })

  it('honours a configured resolution override', () => {
    const prevZone = process.env.BUNNY_CDN_PULL_ZONE
    const prevRes  = process.env.BUNNY_STREAM_MP4_RESOLUTION
    process.env.BUNNY_CDN_PULL_ZONE = 'cdn.example.net'
    process.env.BUNNY_STREAM_MP4_RESOLUTION = '1080p'
    assert.equal(buildBunnyMp4Url('guid-1'), 'https://cdn.example.net/guid-1/play_1080p.mp4')
    if (prevZone === undefined) delete process.env.BUNNY_CDN_PULL_ZONE; else process.env.BUNNY_CDN_PULL_ZONE = prevZone
    if (prevRes === undefined) delete process.env.BUNNY_STREAM_MP4_RESOLUTION; else process.env.BUNNY_STREAM_MP4_RESOLUTION = prevRes
  })
})

describe('isExtractionConfigured', () => {
  it('is false (dormant) when the feature flag is off', () => {
    // The flag is read at module load; it is unset in the test env, so the
    // feature must report dormant — and must not have probed ffmpeg to decide.
    assert.equal(isExtractionConfigured(), false)
  })
})

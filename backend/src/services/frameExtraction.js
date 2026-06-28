/**
 * frameExtraction.js — frame-first candidate artwork generation (Phase 1 of the
 * thumbnail pipeline; see docs/thumbnail-trailer-pipeline.md).
 *
 * Grabs evenly-spaced still frames from a title's encoded video and writes them
 * as `candidate` ThumbnailVariant docs, so a human can pick the good ones in the
 * review grid. Per the doc's v1 scope this is deliberately DUMB — even spacing,
 * no scene detection, no ML scoring (the creator is the scorer). Sharpness/face
 * scoring is a documented v2 enhancement.
 *
 * SAFETY / DORMANCY (this is the important part):
 *   - Hard-gated behind isExtractionConfigured(): both ARTWORK_EXTRACTION_ENABLED
 *     must be 'true' AND an ffmpeg binary must be present. Off by default.
 *   - With the flag off, ffmpeg is never probed and no child process is ever
 *     spawned (short-circuit evaluation).
 *   - It is NOT wired into the upload pipeline. It only runs when an admin
 *     explicitly triggers it. Failures are contained and surfaced, never thrown
 *     into request handling that matters.
 *   - ffmpeg reads the remote MP4 with input-seek (-ss before -i), so it pulls
 *     only the bytes around each timestamp via HTTP range — no full download.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm }      from 'node:fs/promises'
import { tmpdir }           from 'node:os'
import { join }             from 'node:path'
import { createRequire }    from 'node:module'
import { createHash }       from 'node:crypto'
import { cloudinary }       from '../config/cloudinary.js'
import { ThumbnailVariant } from '../models/ThumbnailVariant.js'

const EXTRACTION_ENABLED = process.env.ARTWORK_EXTRACTION_ENABLED === 'true'
const FRAME_TIMEOUT_MS   = 30_000
const MAX_FRAMES         = 20

// Resolve an ffmpeg binary without relying on it being on PATH — which it is
// NOT on Render's `env: node` runtime. Order: explicit FFMPEG_PATH override →
// the ffmpeg-static bundled binary (downloaded at npm install) → system PATH.
// The require is defensive: if the package is somehow absent, we fall back to
// 'ffmpeg' rather than crash the backend on import (admin routes import this).
function resolveFfmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    const require = createRequire(import.meta.url)
    return require('ffmpeg-static') || 'ffmpeg'
  } catch {
    return 'ffmpeg'
  }
}
const FFMPEG_BIN = resolveFfmpegBin()

// ── ffmpeg availability (probed once, lazily, and only if the flag is on) ─────
let _ffmpegChecked = false
let _ffmpegOk      = false
export function ffmpegAvailable() {
  if (_ffmpegChecked) return _ffmpegOk
  _ffmpegChecked = true
  try {
    const r = spawnSync(FFMPEG_BIN, ['-version'], { timeout: 5_000 })
    _ffmpegOk = r.status === 0   // any non-zero/null (missing, EACCES, crash) → stays dormant
  } catch {
    _ffmpegOk = false
  }
  return _ffmpegOk
}

/** True only when the operator has opted in AND ffmpeg is actually installed. */
export function isExtractionConfigured() {
  return EXTRACTION_ENABLED && ffmpegAvailable()
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * Evenly-spaced sample timestamps (seconds) across the middle 80% of a video —
 * the first/last 10% are skipped to avoid intros, title cards and end credits.
 */
export function evenTimestamps(durationSecs, count) {
  const d = Number(durationSecs)
  const n = Math.max(1, Math.min(MAX_FRAMES, Math.floor(Number(count)) || 0))
  if (!Number.isFinite(d) || d <= 0) return []

  const start = d * 0.1
  const span  = d * 0.8
  if (n === 1) return [Math.round(start + span / 2)]

  const out = []
  for (let i = 0; i < n; i++) out.push(Math.round(start + (span * i) / (n - 1)))
  return out
}

/**
 * Signs a Bunny CDN path with the same token-auth scheme the streaming routes
 * use (token = base64url(SHA256(key + path + expires))). Required when the pull
 * zone has Token Authentication enabled — otherwise the MP4 returns 403 and
 * ffmpeg silently gets nothing. Returns an unsigned URL when no key is set (dev).
 */
function signBunnyUrl(path) {
  const pullZone = process.env.BUNNY_CDN_PULL_ZONE
  const base     = `https://${pullZone}${path}`
  const key      = process.env.BUNNY_CDN_TOKEN_AUTH_KEY
  if (!key) return base
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = createHash('sha256').update(key + path + expires).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${base}?token=${token}&expires=${expires}`
}

/** Builds a (token-signed) Bunny MP4-fallback URL for a video GUID + resolution, or null if the CDN isn't configured. */
export function buildBunnyMp4Url(bunnyVideoId, resolution) {
  const pullZone = process.env.BUNNY_CDN_PULL_ZONE
  if (!pullZone || !bunnyVideoId) return null
  const res = resolution || process.env.BUNNY_STREAM_MP4_RESOLUTION || '720p'
  return signBunnyUrl(`/${bunnyVideoId}/play_${res}.mp4`)
}

/**
 * Ordered list of MP4 resolutions to try: an explicit override, else Bunny's
 * own `availableResolutions` (highest first), then a sensible default fallback
 * — so we never hard-guess a rendition the video doesn't actually have.
 */
export function mp4ResolutionOrder(availableResolutions) {
  const override = process.env.BUNNY_STREAM_MP4_RESOLUTION
  let order = []
  if (override) {
    order = [override]
  } else if (availableResolutions) {
    order = String(availableResolutions).split(',').map((s) => s.trim()).filter(Boolean)
      .sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0))
  }
  return [...new Set([...order, '720p', '480p', '1080p', '360p', '240p'])]
}

/**
 * Finds a reachable, token-signed MP4 URL for a Bunny video by probing each
 * candidate resolution with a 1-byte range request. Returns the working URL, or
 * null if none respond (MP4 fallback not enabled / video not re-encoded).
 */
export async function resolveBunnyMp4Url({ bunnyVideoId, availableResolutions }) {
  if (!process.env.BUNNY_CDN_PULL_ZONE || !bunnyVideoId) return null
  for (const res of mp4ResolutionOrder(availableResolutions)) {
    const url = buildBunnyMp4Url(bunnyVideoId, res)
    try {
      const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' } })
      if (r.ok || r.status === 206) return url
    } catch { /* try next resolution */ }
  }
  return null
}

/** Formats seconds as m:ss for a human-readable variant label. */
function tsLabel(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `Frame @ ${m}:${String(s).padStart(2, '0')}`
}

/**
 * Probes a remote video URL with ffprobe to read its duration in seconds.
 * Returns null on any failure (missing binary, timeout, non-video URL, etc.).
 * Only called as a last-resort fallback when Bunny's metadata reports length=0
 * despite the video status showing it has finished encoding.
 */
export function probeDurationSecs(videoUrl) {
  return new Promise((resolve) => {
    let settled = false
    const done = (val) => { if (!settled) { settled = true; resolve(val) } }
    const ffprobe = FFMPEG_BIN.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
    let child
    try {
      child = spawn(ffprobe, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoUrl,
      ], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return done(null)
    }
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* noop */ } done(null) }, 15_000)
    child.on('error', () => { clearTimeout(timer); done(null) })
    child.on('close', () => {
      clearTimeout(timer)
      const secs = parseFloat(out.trim())
      done(Number.isFinite(secs) && secs > 0 ? Math.round(secs) : null)
    })
  })
}

// ── ffmpeg single-frame grab ─────────────────────────────────────────────────

/** Grabs one frame at `ts` seconds to `outPath`. Resolves true on success, false on any failure. */
function grabFrame(videoUrl, ts, outPath) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => { if (!settled) { settled = true; resolve(ok) } }

    let child
    try {
      // -ss before -i = fast input seek (HTTP range); single frame; high quality; overwrite.
      child = spawn(FFMPEG_BIN, [
        '-y', '-ss', String(ts), '-i', videoUrl,
        '-frames:v', '1', '-q:v', '2', outPath,
      ], { stdio: 'ignore' })
    } catch {
      return done(false)
    }

    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* noop */ } done(false) }, FRAME_TIMEOUT_MS)
    child.on('error', () => { clearTimeout(timer); done(false) })
    child.on('close', (code) => { clearTimeout(timer); done(code === 0) })
  })
}

/**
 * Extracts up to `count` frames from a remote video into a fresh temp dir.
 * Returns { dir, frames: [{ ts, path }] }. The caller owns cleanup of `dir`.
 */
export async function extractFrames({ videoUrl, durationSecs, count = 8 }) {
  if (!videoUrl) throw new Error('videoUrl is required')
  const timestamps = evenTimestamps(durationSecs, count)
  if (!timestamps.length) throw new Error('Could not determine sampling timestamps (missing or invalid duration)')

  const dir    = await mkdtemp(join(tmpdir(), 'dhara-frames-'))
  const frames = []
  try {
    for (const ts of timestamps) {
      const outPath = join(dir, `frame-${ts}.jpg`)
      if (await grabFrame(videoUrl, ts, outPath)) frames.push({ ts, path: outPath })
    }
    return { dir, frames }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/**
 * Full pipeline: extract frames, upload each to Cloudinary, and create a
 * `candidate` ThumbnailVariant per uploaded frame. Always cleans up temp files.
 * Returns the created variant docs (may be empty if no frame could be grabbed).
 */
export async function generateFrameVariants({ itemType, itemId, videoUrl, durationSecs, count, createdBy }) {
  const { dir, frames } = await extractFrames({ videoUrl, durationSecs, count })
  try {
    const created = []
    for (const f of frames) {
      let uploaded
      try {
        uploaded = await cloudinary.uploader.upload(f.path, {
          folder:        'dhara/artwork-frames',
          resource_type: 'image',
        })
      } catch {
        continue   // skip a frame whose upload fails; don't abort the whole batch
      }
      const variant = await ThumbnailVariant.create({
        itemType,
        itemId,
        imageUrl:      uploaded.secure_url,
        source:        'frame',
        sourceFrameTs: f.ts,
        status:        'candidate',
        label:         tsLabel(f.ts),
        createdBy:     createdBy || null,
      })
      created.push(variant)
    }
    return created
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

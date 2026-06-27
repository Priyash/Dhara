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
import { cloudinary }       from '../config/cloudinary.js'
import { ThumbnailVariant } from '../models/ThumbnailVariant.js'

const EXTRACTION_ENABLED = process.env.ARTWORK_EXTRACTION_ENABLED === 'true'
const FRAME_TIMEOUT_MS   = 30_000
const MAX_FRAMES         = 20

// ── ffmpeg availability (probed once, lazily, and only if the flag is on) ─────
let _ffmpegChecked = false
let _ffmpegOk      = false
export function ffmpegAvailable() {
  if (_ffmpegChecked) return _ffmpegOk
  _ffmpegChecked = true
  try {
    const r = spawnSync('ffmpeg', ['-version'], { timeout: 5_000 })
    _ffmpegOk = r.status === 0
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

/** Builds the Bunny Stream MP4-fallback URL for a video GUID, or null if the CDN isn't configured. */
export function buildBunnyMp4Url(bunnyVideoId) {
  const pullZone = process.env.BUNNY_CDN_PULL_ZONE
  if (!pullZone || !bunnyVideoId) return null
  const res = process.env.BUNNY_STREAM_MP4_RESOLUTION || '720p'
  return `https://${pullZone}/${bunnyVideoId}/play_${res}.mp4`
}

/** Formats seconds as m:ss for a human-readable variant label. */
function tsLabel(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `Frame @ ${m}:${String(s).padStart(2, '0')}`
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
      child = spawn('ffmpeg', [
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

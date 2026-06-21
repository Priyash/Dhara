/**
 * Shared Bunny Stream upload service.
 * Used by both admin routes and creator reel upload.
 *
 * Reads BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY from env.
 */
import { Readable } from 'stream'
import { UploadJob } from '../models/UploadJob.js'
import { Reel } from '../models/Reel.js'

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID
const accessKey = process.env.BUNNY_STREAM_API_KEY

const DEFAULT_TIMEOUT_MS       = 15_000
const UPLOAD_TIMEOUT_MS        = 30 * 60 * 1000  // 30 min for large files

export async function bunnyRequest(path, { method = 'GET', body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!libraryId || !accessKey) {
    throw new Error('Bunny Stream is not configured. Set BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY.')
  }

  const controller = new AbortController()
  const timeoutId  = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null

  let res
  try {
    const init = {
      method,
      headers: { AccessKey: accessKey, ...headers },
      body,
      signal: controller.signal,
    }
    // Node.js native fetch (undici) requires a Web ReadableStream, not a Node.js Readable.
    // Convert any Node.js stream (e.g. Express req) so fetch can stream it to Bunny CDN.
    if (body && typeof body.pipe === 'function') {
      init.body = Readable.toWeb(body)
      init.duplex = 'half'
    } else if (body instanceof ReadableStream) {
      init.duplex = 'half'
    }
    res = await fetch(`https://video.bunnycdn.com${path}`, init)
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }

  if (!res.ok) {
    throw new Error(typeof data === 'string' ? data : data?.message || `Bunny API HTTP ${res.status}`)
  }
  return data
}

/**
 * Uploads a file buffer to Bunny Stream for a given UploadJob.
 * Sets the job status through uploading → processing.
 * On failure sets status = 'failed' with the error message.
 */
export async function processUploadJob(jobId, fileBuffer, fileSize = 0) {
  try {
    const job = await UploadJob.findById(jobId)
    if (!job) return

    await UploadJob.findByIdAndUpdate(jobId, {
      $set: { status: 'uploading', progress: 20, note: 'Creating video in Bunny Stream...', error: '' },
    })

    const created = await bunnyRequest(`/library/${libraryId}/videos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title: job.title, collectionId: job.bunnyCollectionId }),
    })

    const bunnyVideoId = created?.guid
    if (!bunnyVideoId) throw new Error('Bunny did not return a video ID.')

    await UploadJob.findByIdAndUpdate(jobId, {
      $set: { bunnyVideoId, progress: 45, note: 'Uploading source file to Bunny Stream...' },
    })

    // Persist bunnyVideoId + thumbnailUrl on the Reel immediately so the stream URL
    // and card thumbnail work while Bunny is still transcoding.
    if (job.reelId) {
      const pullZone    = process.env.BUNNY_CDN_PULL_ZONE || ''
      const thumbnailUrl = pullZone ? `https://${pullZone}/${bunnyVideoId}/thumbnail.jpg` : ''
      const reelUpdates = { bunnyVideoId, ...(thumbnailUrl && { thumbnailUrl }) }
      Reel.findByIdAndUpdate(job.reelId, { $set: reelUpdates }).catch(() => {})
    }

    // Content-Length is required — without it Bunny accepts HTTP 200 but internally
    // marks the upload as failed (status 5) because it can't verify the file was complete.
    const putHeaders = { 'Content-Type': 'application/octet-stream' }
    if (fileSize > 0) putHeaders['Content-Length'] = String(fileSize)

    await bunnyRequest(`/library/${libraryId}/videos/${bunnyVideoId}`, {
      method:    'PUT',
      headers:   putHeaders,
      body:      fileBuffer,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })

    await UploadJob.findByIdAndUpdate(jobId, {
      $set: { status: 'processing', progress: 70, note: 'Bunny received the file. Transcoding will begin shortly.' },
    })
  } catch (err) {
    await UploadJob.findByIdAndUpdate(jobId, {
      $set: { status: 'failed', progress: 0, error: err?.message || 'Upload failed' },
    })
    // Re-throw so callers can surface the error: admin route returns 500 to the XHR,
    // reel route uses void + .catch(() => {}) so the job status update is enough.
    throw err
  }
}

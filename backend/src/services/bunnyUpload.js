/**
 * Shared Bunny Stream upload service.
 * Used by both admin routes and creator reel upload.
 *
 * Reads BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY from env.
 */
import { Readable } from 'stream'
import { UploadJob } from '../models/UploadJob.js'
import { Reel } from '../models/Reel.js'
import { Content } from '../models/Content.js'

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
 * Checks whether a Bunny Stream video GUID still exists on the CDN.
 * Returns `false` only on a confirmed 404 (video deleted/never existed).
 * Any other failure (network, auth, Bunny outage) re-throws — callers must
 * never treat an ambiguous error as "deleted", or a transient Bunny outage
 * could trigger mass false-positive soft-deletion of catalog content.
 */
export async function bunnyVideoExists(guid) {
  try {
    await bunnyRequest(`/library/${libraryId}/videos/${guid}`)
    return true
  } catch (err) {
    if (/404|not found/i.test(err?.message || '')) return false
    throw err
  }
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

    // Persist bunnyVideoId on the Reel immediately so the stream URL works while
    // Bunny is still transcoding. The thumbnail is NOT guessed here — Bunny hasn't
    // generated thumbnail.jpg yet at this point (the file isn't even uploaded yet),
    // so writing a guessed URL now would 404 forever. syncProcessingJob() backfills
    // the thumbnail later, once Bunny confirms encoding actually finished.
    if (job.reelId) {
      Reel.findByIdAndUpdate(job.reelId, { $set: { bunnyVideoId } }).catch(() => {})
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

// Bunny Stream video status codes that indicate a terminal failure
const BUNNY_FAIL_STATUSES = new Set([4, 5, 6])

/**
 * Polls Bunny for live encode status of an in-flight UploadJob and advances it.
 * Only flips status to 'ready' (and only then backfills thumbnail/poster fields)
 * once Bunny confirms the video actually finished encoding — never guesses a
 * thumbnail/poster URL ahead of that, since the file won't exist yet and would
 * 404 forever once written to the DB.
 */
export async function syncProcessingJob(job) {
  if (!job.bunnyVideoId || !['processing', 'uploading', 'queued'].includes(job.status)) return job

  try {
    const video = await bunnyRequest(`/library/${libraryId}/videos/${job.bunnyVideoId}`)
    const bunnyStatus   = Number(video?.status ?? -1)
    const encodeProgress = Number(video?.encodeProgress || 0)

    // Bunny status 4 = Resolution not available, 5 = Upload failed, 6 = Failed
    if (BUNNY_FAIL_STATUSES.has(bunnyStatus)) {
      const errMsg = bunnyStatus === 5 ? 'Bunny upload failed — file may be corrupted or too large.'
                   : bunnyStatus === 4 ? 'Bunny could not encode this resolution.'
                   : 'Bunny encoding failed.'
      const failed = await UploadJob.findByIdAndUpdate(
        job._id,
        { $set: { status: 'failed', progress: 0, error: errMsg } },
        { new: true }
      ).catch(() => null)
      return failed || { ...job, status: 'failed', progress: 0, error: errMsg }
    }

    // Bunny status 3 = Finished; also guard on encodeProgress for safety
    const isReady = bunnyStatus === 3 || encodeProgress >= 100

    const nextStatus = isReady ? 'ready' : 'processing'
    const nextProgress = isReady ? 100 : Math.max(70, Math.min(99, Math.round(70 + encodeProgress * 0.29)))

    const updated = await UploadJob.findByIdAndUpdate(
      job._id,
      {
        $set: {
          status: nextStatus,
          progress: nextProgress,
          note: isReady        ? 'Video is ready to stream.'
             : encodeProgress > 0 ? `Bunny is transcoding… ${encodeProgress}% encoded.`
             :                      'Bunny received the file. Transcoding will begin shortly.',
          error: '',
        },
      },
      { new: true }
    )

    if (isReady && updated?.reelId) {
      // Reel upload — link bunnyVideoId and backfill thumbnailUrl from Bunny if reel has none.
      // Bunny generates thumbnail.jpg for every encoded video; use it as fallback so the
      // grid card always has a poster even when the Cloudinary auto-thumb upload raced.
      const existingReel = await Reel.findById(updated.reelId).select('thumbnailUrl').lean()
      const reelPatch = { bunnyVideoId: updated.bunnyVideoId }
      if (!existingReel?.thumbnailUrl) {
        const pullZone        = process.env.BUNNY_CDN_PULL_ZONE
        const thumbnailFile   = video?.thumbnailFileName || 'thumbnail.jpg'
        if (pullZone) reelPatch.thumbnailUrl = `https://${pullZone}/${updated.bunnyVideoId}/${thumbnailFile}`
      }
      await Reel.findByIdAndUpdate(updated.reelId, { $set: reelPatch })
    } else if (isReady && updated?.contentId) {
      if (updated.episodeNumber) {
        // Series / Serial Drama — link to the correct season→episode.
        // seasonNumber defaults to 1 if the upload form didn't provide one.
        const sNum = updated.seasonNumber ?? 1
        const eNum = updated.episodeNumber
        const linked = await Content.findOneAndUpdate(
          { _id: updated.contentId, 'seasons.number': sNum, 'seasons.episodes.number': eNum },
          { $set: { 'seasons.$[s].episodes.$[e].bunnyVideoId': updated.bunnyVideoId } },
          { arrayFilters: [{ 's.number': sNum }, { 'e.number': eNum }], new: true }
        )
        if (!linked) {
          const hasSeason = await Content.exists({ _id: updated.contentId, 'seasons.number': sNum })
          if (hasSeason) {
            await Content.findOneAndUpdate(
              { _id: updated.contentId, 'seasons.number': sNum },
              {
                $push: {
                  'seasons.$.episodes': {
                    number:       eNum,
                    title:        updated.episodeTitle    || `Episode ${eNum}`,
                    duration:     updated.episodeDuration || '',
                    subtitleUrl:  '',
                    bunnyVideoId: updated.bunnyVideoId,
                  },
                },
              }
            )
          } else {
            await Content.findByIdAndUpdate(updated.contentId, {
              $push: {
                seasons: {
                  number:   sNum,
                  title:    '',
                  episodes: [{
                    number:       eNum,
                    title:        updated.episodeTitle    || `Episode ${eNum}`,
                    duration:     updated.episodeDuration || '',
                    subtitleUrl:  '',
                    bunnyVideoId: updated.bunnyVideoId,
                  }],
                },
              },
            })
          }
        }
      } else {
        // Film / Documentary — link to root bunnyVideoId and backfill posterUrl from
        // Bunny if Content has none, same fallback logic as the Reel branch above.
        const existingContent = await Content.findById(updated.contentId).select('posterUrl').lean()
        const contentPatch = { bunnyVideoId: updated.bunnyVideoId }
        if (!existingContent?.posterUrl) {
          const pullZone      = process.env.BUNNY_CDN_PULL_ZONE
          const thumbnailFile = video?.thumbnailFileName || 'thumbnail.jpg'
          if (pullZone) contentPatch.posterUrl = `https://${pullZone}/${updated.bunnyVideoId}/${thumbnailFile}`
        }
        await Content.findByIdAndUpdate(updated.contentId, { $set: contentPatch })
      }
    }

    return updated || job
  } catch (err) {
    // If Bunny returns 404 the video was deleted from the CDN — mark the job
    // as failed immediately so it stops showing "Transcoding…" in the UI.
    const isGone = /404|not found/i.test(err?.message || '')
    if (isGone) {
      const failed = await UploadJob.findByIdAndUpdate(
        job._id,
        { $set: { status: 'failed', progress: 0, error: 'Video was deleted from Bunny CDN.' } },
        { new: true }
      ).catch(() => null)
      return failed || { ...job, status: 'failed', progress: 0, error: 'Video was deleted from Bunny CDN.' }
    }
    return job
  }
}

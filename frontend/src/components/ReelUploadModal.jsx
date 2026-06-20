import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Upload, Video, Hash, CheckCircle2, AlertTriangle,
  Loader2, Info, Play, Clock, AlignLeft, ImagePlus,
} from 'lucide-react'
import { createCreatorReel, createReelUploadJob, uploadReelFile } from '../services/api'
import { uploadToCloudinary } from '../services/cloudinary'
import { useStore } from '../store/useStore'
import styles from './ReelUploadModal.module.css'

let _nextReelUid = 0

function _clearReelJob(reelId) {
  try {
    const stored = JSON.parse(localStorage.getItem('dhara_reel_jobs') || '[]')
    localStorage.setItem('dhara_reel_jobs', JSON.stringify(stored.filter((j) => j.reelId !== reelId)))
  } catch {}
}

const MAX_DURATION_SECS = 30
const MAX_FILE_MB       = 200
const ALLOWED_EXT       = ['.mp4', '.mov', '.m4v', '.webm']
const ASPECT_RATIOS     = ['9:16', '16:9', '1:1']

const uid = () => Math.random().toString(36).slice(2)

function cleanName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim()
}

function fmtSize(b) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function validateFile(file) {
  if (!file.type.startsWith('video/')) return 'Not a video file.'
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) return `Unsupported format. Use: ${ALLOWED_EXT.join(', ')}`
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `Exceeds ${MAX_FILE_MB} MB limit.`
  return null
}

// Analyse video: duration, dimensions, aspect ratio + capture thumbnail frame
function analyseVideo(file) {
  return new Promise((resolve) => {
    const video  = document.createElement('video')
    const canvas = document.createElement('canvas')
    const url    = URL.createObjectURL(file)
    let   settled = false

    const finish = () => {
      if (settled) return
      settled = true

      const { duration, videoWidth: w, videoHeight: h } = video
      const r = w > 0 && h > 0 ? w / h : 0
      const aspectRatio = r >= 1.5 ? '16:9' : r >= 0.85 && r <= 1.15 ? '1:1' : '9:16'

      let thumb = null
      try {
        const scale = w > 0 ? Math.min(1, 360 / w) : 1
        canvas.width  = Math.round(w * scale) || 360
        canvas.height = Math.round(h * scale) || 640
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        thumb = canvas.toDataURL('image/jpeg', 0.8)
      } catch {}

      URL.revokeObjectURL(url)
      resolve({ duration, width: w, height: h, aspectRatio, thumb })
    }

    // preload='auto' ensures actual video data loads so the seek produces a real frame.
    // Seeking to 1e-5 avoids the blank frame some codecs return at exactly t=0.
    video.preload = 'auto'
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1e-5, video.duration)
    }
    video.onseeked = finish
    // Fallback: if seeked never fires (e.g. unsupported codec), draw whatever is loaded
    video.onloadeddata = () => setTimeout(() => { if (!settled) finish() }, 200)
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ duration: 0, width: 0, height: 0, aspectRatio: '9:16', thumb: null })
    }
    video.src = url
  })
}

// Convert a base64 data URL to a File object for Cloudinary upload
function dataUrlToFile(dataUrl, filename) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const bytes = atob(data)
  const arr   = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], filename, { type: mime })
}

export default function ReelUploadModal({ onClose, onCreated }) {
  // queue item: { id, file, title, duration, aspectRatio, thumb, validError, status, progress, error }
  // status: 'pending' | 'uploading' | 'done' | 'error'
  const [queue,               setQueue]               = useState([])
  const [sharedDescription,   setSharedDescription]   = useState('')
  const [sharedHashtags,      setSharedHashtags]       = useState('')
  const [sharedAspectRatio,   setSharedAspectRatio]   = useState('')   // '' = auto-detect per file
  const [phase,               setPhase]               = useState('configure')
  const [summary,             setSummary]             = useState(null)
  const [dragging,            setDragging]            = useState(false)
  const [thumbnailUrl,        setThumbnailUrl]        = useState('')
  const [thumbUploading,      setThumbUploading]      = useState(false)
  const [thumbError,          setThumbError]          = useState('')

  const addActiveUpload    = useStore((s) => s.addActiveUpload)
  const patchActiveUpload  = useStore((s) => s.patchActiveUpload)
  const removeActiveUpload = useStore((s) => s.removeActiveUpload)

  const inputRef      = useRef(null)
  const thumbInputRef = useRef(null)
  const queueRef      = useRef(queue)
  queueRef.current    = queue
  const uploadingRef  = useRef(false)

  // ── Add files to queue ────────────────────────────────────────────────────

  const addFiles = useCallback(async (files) => {
    const incoming = Array.from(files)
    const items = incoming.map((file) => ({
      id: uid(), file,
      title:             cleanName(file.name),
      duration:          0,
      aspectRatio:       '9:16',
      thumb:             null,
      autoThumbUrl:      null,
      autoThumbUploading: false,
      validError:        validateFile(file),
      status:            'pending',
      progress:          0,
      error:             null,
    }))
    setQueue((prev) => [...prev, ...items])

    // Analyse valid files in background (fills duration, aspectRatio, thumb)
    for (const item of items) {
      if (item.validError) continue
      analyseVideo(item.file).then(async (meta) => {
        if (meta.duration > MAX_DURATION_SECS) {
          setQueue((prev) => prev.map((q) => q.id === item.id
            ? { ...q, validError: `${Math.round(meta.duration)}s — max ${MAX_DURATION_SECS}s` }
            : q))
          return
        }
        setQueue((prev) => prev.map((q) => q.id === item.id
          ? { ...q, duration: Math.round(meta.duration), aspectRatio: meta.aspectRatio, thumb: meta.thumb, autoThumbUploading: !!meta.thumb }
          : q))

        // Auto-upload the captured frame so every reel has a thumbnail
        if (meta.thumb) {
          try {
            const thumbFile = dataUrlToFile(meta.thumb, 'thumb.jpg')
            const url = await uploadToCloudinary(thumbFile, { folder: 'dhara/reels/thumbnails' })
            setQueue((prev) => prev.map((q) => q.id === item.id
              ? { ...q, autoThumbUrl: url, autoThumbUploading: false }
              : q))
          } catch {
            setQueue((prev) => prev.map((q) => q.id === item.id
              ? { ...q, autoThumbUploading: false }
              : q))
          }
        }
      })
    }
  }, [])

  const onDrop = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }
  const removeItem = (id) => setQueue((prev) => prev.filter((q) => q.id !== id))
  const updateTitle = (id, title) => setQueue((prev) => prev.map((q) => q.id === id ? { ...q, title } : q))

  // ── Upload queue sequentially ─────────────────────────────────────────────

  const startUpload = async () => {
    if (uploadingRef.current) return  // prevent double-submit
    const valid = queue.filter((q) => !q.validError)
    if (!valid.length) return
    uploadingRef.current = true
    setPhase('uploading')

    let done = 0, failed = 0
    const tags = sharedHashtags.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean)

    for (const item of valid) {
      // Register in the global store immediately — progress survives modal close
      const uid = `reel-${_nextReelUid++}`
      const displayTitle = item.title.trim() || cleanName(item.file.name)
      addActiveUpload({ uid, type: 'reel', title: displayTitle, progress: 0, status: 'uploading', xhr: null })

      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: 'uploading', progress: 0 } : q))
      try {
        // Wait up to 8 s for the Cloudinary auto-thumb upload to settle before
        // reading autoThumbUrl — closes the race between analyseVideo + Cloudinary
        // upload and the user clicking "Upload" quickly after adding files.
        const isStillUploading = () =>
          !!(queueRef.current.find((q) => q.id === item.id)?.autoThumbUploading)
        if (isStillUploading()) {
          await new Promise((resolve) => {
            const deadline = Date.now() + 8_000
            const poll = () => {
              if (!isStillUploading() || Date.now() >= deadline) resolve()
              else setTimeout(poll, 200)
            }
            poll()
          })
        }
        const freshItem  = queueRef.current.find((q) => q.id === item.id) || item
        const thumbToUse = thumbnailUrl.trim() || freshItem.autoThumbUrl || ''

        const reel = await createCreatorReel({
          title:        displayTitle,
          description:  sharedDescription.trim(),
          hashtags:     tags,
          aspectRatio:  sharedAspectRatio || item.aspectRatio,
          durationSecs: item.duration,
          thumbnailUrl: thumbToUse,
        }).catch((err) => {
          if (err?.message?.includes('Daily upload limit')) {
            throw new Error('Daily limit reached — you can upload up to 5 reels per day.')
          }
          throw err
        })
        await createReelUploadJob(reel._id)

        // Persist to localStorage so the upload toast survives a page refresh
        try {
          const stored = JSON.parse(localStorage.getItem('dhara_reel_jobs') || '[]')
          stored.push({ reelId: reel._id, title: displayTitle, startedAt: Date.now() })
          localStorage.setItem('dhara_reel_jobs', JSON.stringify(stored))
        } catch {}

        let lastProgressEmit = 0
        await uploadReelFile(reel._id, item.file, {
          onXhr: (xhr) => {
            xhr.timeout = 90 * 60 * 1000
            patchActiveUpload(uid, { xhr })
            xhr.addEventListener('timeout', () => {
              const msg = 'Upload timed out after 90 minutes'
              setQueue((prev) => prev.map((q) => q.id === item.id
                ? { ...q, status: 'error', error: msg } : q))
              patchActiveUpload(uid, { status: 'error', error: msg, xhr: null })
            })
          },
          onProgress: (p) => {
            const now = Date.now()
            if (p < 100 && now - lastProgressEmit < 150) return
            lastProgressEmit = now
            setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, progress: p } : q))
            patchActiveUpload(uid, { progress: p })
          },
        })
        setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: 'done', progress: 100 } : q))
        patchActiveUpload(uid, { progress: 100, status: 'done', xhr: null })
        setTimeout(() => removeActiveUpload(uid), 8_000)
        _clearReelJob(reel._id)
        done++
      } catch (err) {
        const msg = err?.message || 'Upload failed'
        setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: 'error', error: msg } : q))
        patchActiveUpload(uid, { status: 'error', error: msg, xhr: null })
        if (reel) _clearReelJob(reel._id)
        failed++
      }
    }

    uploadingRef.current = false
    setSummary({ done, failed })
    setPhase('complete')
    if (done > 0) onCreated?.()
  }

  const validCount   = queue.filter((q) => !q.validError).length
  const invalidCount = queue.filter((q) =>  q.validError).length
  const isUploading  = phase === 'uploading'
  const isComplete   = phase === 'complete'

  // XHR upload continues in the browser even after the modal unmounts —
  // the backend buffers the file and fires processUploadJob asynchronously,
  // so the reel always finishes uploading. Confirm before closing mid-upload
  // so the user doesn't lose visibility into a multi-file batch by accident.
  const handleClose = () => {
    if (isUploading) {
      const ok = window.confirm(
        'Upload in progress. Close anyway?\n\n' +
        'Your reel will continue uploading in the background and will be submitted for review once complete.'
      )
      if (!ok) return
    }
    onClose()
  }

  // Portal renders outside the route pane so CSS transforms on animated
  // parent elements can't break position:fixed on the backdrop.
  return createPortal(
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className={styles.modal}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Video size={16} className={styles.headerIcon} />
            <h2 className={styles.heading}>Upload Reels</h2>
            {queue.length > 0 && (
              <span className={styles.queueBadge}>{queue.length} file{queue.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>

          {/* ── Rules notice (only in configure phase) ── */}
          {phase === 'configure' && (
            <div className={styles.notice}>
              <Info size={13} />
              <span>Max <strong>30 s</strong> · <strong>{MAX_FILE_MB} MB</strong> · MP4, MOV, WebM · All reels go through admin review.</span>
            </div>
          )}

          {/* ── Complete summary ── */}
          {isComplete && summary && (
            <div className={styles.summaryCard}>
              <CheckCircle2 size={28} className={styles.summaryIcon} />
              <h3 className={styles.summaryTitle}>
                {summary.done} reel{summary.done !== 1 ? 's' : ''} submitted for review
              </h3>
              {summary.failed > 0 && (
                <p className={styles.summaryFailed}>{summary.failed} failed — see details below</p>
              )}
              <p className={styles.summarySub}>You'll be notified once they're reviewed.</p>
            </div>
          )}

          {/* ── Drop zone ── */}
          {phase === 'configure' && (
            <div
              className={`${styles.dropZone} ${dragging ? styles.dropZoneDrag : ''} ${queue.length > 0 ? styles.dropZoneCompact : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
                multiple
                className={styles.hiddenInput}
                onChange={(e) => addFiles(e.target.files)}
              />
              <Upload size={queue.length > 0 ? 16 : 22} className={styles.dropIcon} />
              <p className={styles.dropTitle}>
                {queue.length > 0 ? 'Add more videos' : 'Drop videos here'}
              </p>
              <p className={styles.dropSub}>MP4, MOV · max {MAX_DURATION_SECS}s · {MAX_FILE_MB} MB · select multiple</p>
            </div>
          )}

          {/* ── Queue ── */}
          {queue.length > 0 && (
            <div className={styles.queueList}>
              {queue.map((item) => (
                <div
                  key={item.id}
                  className={`${styles.queueItem}
                    ${item.status === 'done'      ? styles.queueItemDone    : ''}
                    ${item.status === 'error'     ? styles.queueItemError   : ''}
                    ${item.status === 'uploading' ? styles.queueItemActive  : ''}
                    ${item.validError             ? styles.queueItemInvalid : ''}
                  `}
                >
                  {/* Thumbnail */}
                  <div
                    className={styles.queueThumb}
                    style={item.thumb ? { backgroundImage: `url(${item.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                  >
                    {!item.thumb && <Video size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />}
                    {item.autoThumbUploading && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', borderRadius: 'inherit' }}>
                        <Loader2 size={14} className={styles.spin} />
                      </div>
                    )}
                    {item.duration > 0 && <span className={styles.queueDur}>{item.duration}s</span>}
                  </div>

                  {/* Info */}
                  <div className={styles.queueInfo}>
                    {phase === 'configure' && !item.validError ? (
                      <input
                        className={styles.queueTitleInput}
                        value={item.title}
                        onChange={(e) => updateTitle(item.id, e.target.value)}
                        placeholder="Reel caption…"
                        maxLength={120}
                      />
                    ) : (
                      <p className={styles.queueTitleStatic}>{item.title || cleanName(item.file.name)}</p>
                    )}
                    <div className={styles.queueMeta}>
                      <span>{fmtSize(item.file.size)}</span>
                      {item.duration > 0 && <span>{item.duration}s</span>}
                      <span>{item.aspectRatio}</span>
                      {item.validError && <span className={styles.queueValidError}><AlertTriangle size={11} /> {item.validError}</span>}
                      {item.error      && <span className={styles.queueValidError}><AlertTriangle size={11} /> {item.error}</span>}
                    </div>

                    {/* Progress bar for active item */}
                    {item.status === 'uploading' && (
                      <div className={styles.queueProgress}>
                        <div className={styles.queueProgressFill} style={{ width: `${item.progress}%` }} />
                        <span className={styles.queueProgressLabel}>{item.progress < 100 ? `${item.progress}%` : 'Processing…'}</span>
                      </div>
                    )}
                  </div>

                  {/* Status indicator */}
                  <div className={styles.queueStatus}>
                    {item.status === 'done'      && <CheckCircle2 size={18} className={styles.statusDone} />}
                    {item.status === 'uploading' && <Loader2      size={18} className={styles.statusLoading} />}
                    {item.status === 'error'     && <AlertTriangle size={18} className={styles.statusError} />}
                    {item.validError             && <AlertTriangle size={18} className={styles.statusError} />}
                    {item.status === 'pending' && !item.validError && phase === 'uploading' && (
                      <Clock size={16} className={styles.statusWaiting} />
                    )}
                    {phase === 'configure' && !item.validError && (
                      <button className={styles.queueRemove} onClick={() => removeItem(item.id)} aria-label="Remove">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Shared metadata — always visible in configure ── */}
          {phase === 'configure' && (
            <div className={styles.fields}>
              <div className={styles.field}>
                <label className={styles.label}>
                  <AlignLeft size={12} /> Description
                  <span className={styles.optional}>(shared across all reels in this upload)</span>
                </label>
                <textarea
                  className={styles.textarea}
                  value={sharedDescription}
                  onChange={(e) => setSharedDescription(e.target.value)}
                  placeholder="Add context, story, or notes about this batch…"
                  rows={2}
                  maxLength={500}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>
                  <Hash size={12} /> Hashtags
                  <span className={styles.optional}>(comma-separated, applied to all reels)</span>
                </label>
                <input
                  className={styles.input}
                  value={sharedHashtags}
                  onChange={(e) => setSharedHashtags(e.target.value)}
                  placeholder="bengali, drama, comedy"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>
                  Aspect Ratio
                  <span className={styles.optional}>(leave on Auto to detect per file)</span>
                </label>
                <div className={styles.ratioGroup}>
                  {['Auto', ...ASPECT_RATIOS].map((r) => {
                    const val = r === 'Auto' ? '' : r
                    return (
                      <button key={r} type="button"
                        className={`${styles.ratioBtn} ${sharedAspectRatio === val ? styles.ratioBtnActive : ''}`}
                        onClick={() => setSharedAspectRatio(val)}>
                        {r}
                      </button>
                    )
                  })}
                </div>
                <p className={styles.ratioHint}>
                  {sharedAspectRatio
                    ? `All reels will use ${sharedAspectRatio}.`
                    : '9:16 is recommended for vertical mobile reels. Each file\'s ratio will be auto-detected.'}
                </p>
              </div>

              {/* Thumbnail upload */}
              <div className={styles.field}>
                <label className={styles.label}>
                  <ImagePlus size={12} /> Cover thumbnail
                  <span className={styles.optional}>(optional · shown in the Reels feed before playback)</span>
                </label>
                <input
                  ref={thumbInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  className={styles.hiddenInput}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setThumbError('')
                    setThumbUploading(true)
                    try {
                      const url = await uploadToCloudinary(f, { folder: 'dhara/reels/thumbnails' })
                      setThumbnailUrl(url)
                    } catch (err) {
                      setThumbError(err?.message || 'Thumbnail upload failed')
                    } finally {
                      setThumbUploading(false)
                      e.target.value = ''
                    }
                  }}
                />
                <div className={styles.thumbRow}>
                  {thumbnailUrl ? (
                    <>
                      <img src={thumbnailUrl} alt="Thumbnail preview" className={styles.thumbPreview} />
                      <div className={styles.thumbActions}>
                        <button type="button" className={styles.thumbChangeBtn}
                          onClick={() => thumbInputRef.current?.click()} disabled={thumbUploading}>
                          Change
                        </button>
                        <button type="button" className={styles.thumbRemoveBtn}
                          onClick={() => setThumbnailUrl('')}>
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <button type="button" className={styles.thumbUploadBtn}
                      onClick={() => thumbInputRef.current?.click()} disabled={thumbUploading}>
                      {thumbUploading
                        ? <><Loader2 size={14} className={styles.spin} /> Uploading…</>
                        : <><ImagePlus size={14} /> Upload cover image</>}
                    </button>
                  )}
                </div>
                {thumbError && <p className={styles.fieldError}><AlertTriangle size={12} /> {thumbError}</p>}
              </div>

            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={handleClose}>
            {isComplete ? 'Close' : 'Cancel'}
          </button>

          {phase === 'configure' && validCount > 0 && (
            <button className={styles.submitBtn} onClick={startUpload}>
              <Play size={14} fill="currentColor" />
              Upload {validCount} reel{validCount !== 1 ? 's' : ''}
              {invalidCount > 0 && ` (${invalidCount} skipped)`}
            </button>
          )}

          {phase === 'configure' && queue.length > 0 && validCount === 0 && (
            <span className={styles.footerNote}>Fix the errors above before uploading.</span>
          )}
        </div>

      </div>
    </div>,
    document.body
  )
}

import { useRef, useState, useEffect, useCallback } from 'react'
import Hls from 'hls.js'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Settings, Loader2, RotateCcw, PictureInPicture2,
  Airplay,
} from 'lucide-react'
import styles from './VideoPlayer.module.css'

function formatTime(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`
}

function formatRemaining(secs) {
  if (!isFinite(secs) || secs <= 0) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m left`
  if (m > 0) return `${m}m left`
  return `${Math.floor(secs)}s left`
}

function gcd(a, b) { return b ? gcd(b, a % b) : a }

function aspectRatioLabel(w, h) {
  if (!w || !h) return ''
  const d  = gcd(w, h)
  const rw = w / d, rh = h / d
  const r  = w / h
  const known = [[16,9],[4,3],[21,9],[2,1],[3,2],[1,1]]
  for (const [a, b] of known) {
    if (Math.abs(rw / rh - a / b) < 0.02) return `${a}:${b}`
  }
  if (Math.abs(r - 2.39) < 0.06) return '2.39:1'
  if (Math.abs(r - 2.35) < 0.06) return '2.35:1'
  if (Math.abs(r - 1.85) < 0.06) return '1.85:1'
  return `${rw}:${rh}`
}

function isHlsSource(videoSrc) {
  if (!videoSrc) return false
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/'
    return new URL(videoSrc, base).pathname.toLowerCase().endsWith('.m3u8')
  } catch {
    return videoSrc.split('?')[0].toLowerCase().endsWith('.m3u8')
  }
}

function mediaErrorMessage(error) {
  switch (error?.code) {
    case 1:
      return 'Playback was interrupted. Please retry.'
    case 2:
      return 'Network trouble interrupted the stream. Please retry.'
    case 3:
      return 'This video could not be decoded by the browser.'
    case 4:
      return 'This stream format is not supported here.'
    default:
      return 'Playback failed. Please retry.'
  }
}

function qualityLabel(level) {
  const h    = level?.height ? `${level.height}p` : 'Auto'
  const kbps = level?.bitrate ? Math.round(level.bitrate / 1000) : null
  return kbps ? `${h} · ${kbps}kbps` : h
}

export default function VideoPlayer({ src, title, poster, storageKey }) {
  const videoRef    = useRef(null)
  const containerRef= useRef(null)
  const progressRef = useRef(null)
  const fillRef     = useRef(null)
  const thumbRef      = useRef(null)
  const hlsRef        = useRef(null)
  const saveTimer     = useRef(null)
  const didSeek       = useRef(false)
  const thumbnailRef  = useRef(null)
  const bufferingTimerRef = useRef(null)
  const captureAnimRef    = useRef(null)
  const thumbVideoRef     = useRef(null)
  const thumbHlsRef       = useRef(null)
  const thumbSeekPending  = useRef(false)
  const frameCacheRef     = useRef(new Map())   // second → ImageBitmap  (video-based fallback)
  const imgCacheRef       = useRef(new Map())   // second → HTMLImageElement | null(pending)
  const rVFCRef           = useRef(null)        // rVFC handle on main video (playback capture)
  const thumbRVFCRef      = useRef(null)        // rVFC handle on thumb video (seek capture)
  const hoverTimeRef      = useRef(null)        // latest requested hover/drag time

  const thumbUrlFor = null
  const thumbHasFrame = useRef(false)

  const [playing,          setPlaying]          = useState(false)
  const [currentTime,      setCurrentTime]      = useState(0)
  const [duration,         setDuration]         = useState(0)
  const [volume,           setVolume]           = useState(1)
  const [muted,            setMuted]            = useState(false)
  const [fullscreen,       setFullscreen]       = useState(false)
  const [buffered,         setBuffered]         = useState(0)
  const [buffering,        setBuffering]        = useState(false)
  const [showSettings,     setShowSettings]     = useState(false)
  const [playbackRate,     setPlaybackRate]     = useState(1)
  const [qualityOptions,   setQualityOptions]   = useState([])
  const [qualityValue,     setQualityValue]     = useState('auto')
  const [playerError,      setPlayerError]      = useState('')
  const [pipEnabled,       setPipEnabled]       = useState(false)
  const [hoverTime,        setHoverTime]        = useState(null)
  const [hoverPct,         setHoverPct]         = useState(0)
  const [isDragging,       setIsDragging]       = useState(false)
  const [videoHovered,     setVideoHovered]     = useState(false)
  const [showControls,     setShowControls]     = useState(true)
  const [videoNaturalSize, setVideoNaturalSize] = useState({ w: 0, h: 0 })
  const [streamMode,       setStreamMode]       = useState('')
  const [activeQualityLabel, setActiveQualityLabel] = useState('')
  const idleTimerRef     = useRef(null)

  // ── Cast / AirPlay ──────────────────────────────────────────────────────────
  const [castAvailable, setCastAvailable] = useState(false)
  const [castConnected, setCastConnected] = useState(false)

  // ── Keyboard shortcut hint ──────────────────────────────────────────────────
  const [shortcutHint,    setShortcutHint]    = useState(null)
  const shortcutHintTimer = useRef(null)

  // ── Stale-closure guards for keyboard handler ───────────────────────────────
  const playingRef  = useRef(false)
  const volumeRef   = useRef(1)
  const mutedRef    = useRef(false)

  // ── Double-click / double-tap detection ────────────────────────────────────
  const clickTimerRef = useRef(null)
  const tapCountRef   = useRef(0)
  const tapTimerRef   = useRef(null)

  const progress  = duration ? (currentTime / duration) * 100 : 0
  const bufferPct = duration ? (buffered  / duration) * 100 : 0
  const remaining = duration - currentTime

  const STORAGE_KEY = storageKey ? `dhara_progress_${storageKey}` : null

  const saveProgress = useCallback(() => {
    if (!STORAGE_KEY || !videoRef.current) return
    const t = videoRef.current.currentTime
    const d = videoRef.current.duration
    if (t > 5) {
      localStorage.setItem(STORAGE_KEY, String(t))
      if (isFinite(d) && d > 0) localStorage.setItem(`${STORAGE_KEY}_dur`, String(d))
    }
  }, [STORAGE_KEY])

  const captureFrame = useCallback((source) => {
    const canvas = thumbnailRef.current
    const vid    = source ?? thumbVideoRef.current
    if (!canvas || !vid || vid.readyState < 2) return
    try {
      canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height)
      if (!thumbHasFrame.current) {
        thumbHasFrame.current = true
        canvas.style.opacity = '1'
      }
    } catch { /* ignore */ }
  }, [])

  const clearThumbnailCanvas = useCallback(() => {
    const canvas = thumbnailRef.current
    if (!canvas) return
    thumbHasFrame.current = false
    canvas.style.opacity = '0'
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  // Draw the exact cached ImageBitmap for `time` (video-based fallback). Returns true on hit.
  const drawFromCache = useCallback((time) => {
    const cache  = frameCacheRef.current
    const canvas = thumbnailRef.current
    if (!cache.size || !canvas) return false
    const target = Math.round(time)
    const exact = cache.get(target)
    if (!exact) return false
    try {
      canvas.getContext('2d').drawImage(exact, 0, 0, canvas.width, canvas.height)
      thumbHasFrame.current = true
      canvas.style.opacity = '1'
      return true
    } catch { return false }
  }, [])

  // Kick off a background JPEG load for `sec` from the provider's thumbnail API.
  // Each image is ~5–15 KB — orders of magnitude smaller than an HLS segment.
  // No crossOrigin header: we only call drawImage (no canvas readback), so CORS
  // is not required and setting it would break CDNs without CORS headers.
  const preloadImg = useCallback((sec) => {
    if (!thumbUrlFor || imgCacheRef.current.has(sec)) return
    imgCacheRef.current.set(sec, null)       // mark pending so we don't double-request
    const img = new Image()
    img.dataset.sec = String(sec)
    img.onload  = () => imgCacheRef.current.set(sec, img)
    img.onerror = () => imgCacheRef.current.delete(sec)  // allow retry
    img.src = thumbUrlFor(sec)
  }, [thumbUrlFor])

  // Draw the exact loaded JPEG thumbnail for `time`. Returns true on hit.
  const drawFromImgCache = useCallback((time, allowNearest = false) => {
    const canvas = thumbnailRef.current
    if (!canvas) return false
    const target = Math.round(time)
    const exact = imgCacheRef.current.get(target)
    if (exact?.complete && exact.naturalWidth) {
      try {
        canvas.getContext('2d').drawImage(exact, 0, 0, canvas.width, canvas.height)
        thumbHasFrame.current = true
        canvas.style.opacity = '1'
        return true
      } catch { return false }
    }
    if (!allowNearest) return false

    let best = null, bestDist = Infinity
    for (const [sec, img] of imgCacheRef.current) {
      if (!img?.complete || !img.naturalWidth) continue   // skip pending / failed
      const d = Math.abs(sec - target)
      if (d < bestDist) { bestDist = d; best = img }
    }
    if (!best) return false
    try {
      canvas.getContext('2d').drawImage(best, 0, 0, canvas.width, canvas.height)
      thumbHasFrame.current = true
      canvas.style.opacity = '1'
      return true
    } catch { return false }
  }, [])

  const cleanupHls = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
  }, [])

  const autoPlayAndResume = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (STORAGE_KEY && !didSeek.current) {
      const saved = parseFloat(localStorage.getItem(STORAGE_KEY) || '0')
      if (saved > 5 && isFinite(saved)) v.currentTime = saved
      didSeek.current = true
    }
    v.play().catch(() => {})
  }, [STORAGE_KEY])

  const attachNativeSource = useCallback((v, nextSrc, mode = '') => {
    v.src = nextSrc
    setStreamMode(mode)
    setActiveQualityLabel(mode === 'native-hls' ? 'Native HLS' : '')
    if (mode === 'native-hls') {
      setQualityOptions([])
      setQualityValue('auto')
    }
    v.addEventListener('loadedmetadata', autoPlayAndResume, { once: true })
    return () => v.removeEventListener('loadedmetadata', autoPlayAndResume)
  }, [autoPlayAndResume])

  const attachHlsSource = useCallback((v, nextSrc) => {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
    })

    setStreamMode('hls')
    setActiveQualityLabel('Auto')
    hls.loadSource(nextSrc)
    hls.attachMedia(v)
    hlsRef.current = hls

    hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      const levels = data.levels || []
      setQualityOptions(levels.map((l, i) => ({ value: String(i), label: qualityLabel(l) })))
      setQualityValue('auto')
      setActiveQualityLabel(levels.length ? `Auto · ${levels.length} levels` : 'Auto')
      autoPlayAndResume()
    })

    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      const level = hls.levels?.[data.level]
      if (level) setActiveQualityLabel(qualityLabel(level))
    })

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        setPlayerError('')
        hls.startLoad()
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        setPlayerError('')
        hls.recoverMediaError()
        return
      }
      setPlayerError('Playback failed. Please retry.')
    })

    return cleanupHls
  }, [autoPlayAndResume, cleanupHls])

  useEffect(() => {
    const v = videoRef.current
    if (!src || !v) return
    setPlayerError('')
    setQualityOptions([])
    setQualityValue('auto')
    setActiveQualityLabel('')
    setStreamMode('')
    didSeek.current = false
    cleanupHls()

    if (isHlsSource(src)) {
      if (Hls.isSupported()) {
        return attachHlsSource(v, src)
      }
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        return attachNativeSource(v, src, 'native-hls')
      }
      setPlayerError('This browser cannot play HLS streams.')
      return undefined
    }
    return attachNativeSource(v, src)
  }, [src, cleanupHls, attachHlsSource, attachNativeSource])

  // Clear all thumbnail caches when src changes
  useEffect(() => {
    imgCacheRef.current.clear()
    frameCacheRef.current.clear()
  }, [src])

  // Load src into the hidden thumbnail video (crossOrigin allows canvas capture)
  useEffect(() => {
    const tv = thumbVideoRef.current
    if (!tv || !src) return
    if (thumbHlsRef.current) { thumbHlsRef.current.destroy(); thumbHlsRef.current = null }

    if (isHlsSource(src) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, maxBufferLength: 10, backBufferLength: 0, startLevel: 0 })
      hls.loadSource(src)
      hls.attachMedia(tv)
      // Force the lowest quality level for thumbnail video — smallest segments
      // means fastest seek → faster frame capture across the whole timeline.
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const levels = data.levels || []
        if (levels.length > 1) {
          const lowest = levels.reduce((min, l, i) => (l.bitrate < levels[min].bitrate ? i : min), 0)
          hls.currentLevel = lowest
        }
      })
      thumbHlsRef.current = hls
    } else {
      tv.src = src
    }
    return () => { if (thumbHlsRef.current) { thumbHlsRef.current.destroy(); thumbHlsRef.current = null } }
  }, [src])

  useEffect(() => {
    if (playing) {
      saveTimer.current = setInterval(saveProgress, 10_000)
    } else {
      clearInterval(saveTimer.current)
      saveProgress()
    }
    return () => clearInterval(saveTimer.current)
  }, [playing, saveProgress])

  // Primary thumbnail approach: preload provider JPEG thumbnails every 1 s across the
  // full timeline. Each image is ~5–15 KB (vs HLS segments at 500 KB–5 MB), so the
  // browser fetches them ~50× faster. Requests are staggered to avoid a CDN burst.
  useEffect(() => {
    if (duration <= 0 || !thumbUrlFor || !preloadImg) return
    const STEP = 1
    let pos = 0
    const timer = setInterval(() => {
      if (pos >= duration) { clearInterval(timer); return }
      preloadImg(Math.floor(pos))
      pos += STEP
    }, 45)
    return () => clearInterval(timer)
  }, [duration, thumbUrlFor, preloadImg])

  // Fallback harvest: seek the thumb video through the timeline when no Bunny
  // thumbnail API is available (non-Bunny hosts or localhost dev).
  useEffect(() => {
    if (duration <= 0 || thumbUrlFor) return   // skip when JPEG approach is active
    const tv = thumbVideoRef.current
    if (!tv) return

    const HARVEST_STEP = 1    // one frame per second
    let cancelled = false

    const harvest = async () => {
      for (let pos = 0; pos < duration; pos += HARVEST_STEP) {
        if (cancelled) break
        const sec = Math.floor(pos)
        if (frameCacheRef.current.has(sec)) continue

        // Yield the thumb video to the user's interactive hover/drag seek — wait
        // until they leave the progress bar before resuming background harvesting.
        while (hoverTimeRef.current !== null && !cancelled) {
          await new Promise(r => setTimeout(r, 150))
        }
        if (cancelled) break

        await new Promise(resolve => {
          tv.currentTime = pos
          const onSeeked = () => resolve()
          tv.addEventListener('seeked', onSeeked, { once: true })
          // Safety timeout — skip a position if it stalls for over 3 s
          setTimeout(resolve, 3000)
        })
        if (cancelled) break

        try {
          const bmp = await createImageBitmap(tv, { resizeWidth: 160, resizeHeight: 90 })
          frameCacheRef.current.set(sec, bmp)
        } catch {
          const c = document.createElement('canvas')
          c.width = 160; c.height = 90
          try { c.getContext('2d').drawImage(tv, 0, 0, 160, 90); frameCacheRef.current.set(sec, c) } catch {}
        }
      }
    }

    harvest()
    return () => { cancelled = true }
  }, [duration])

  // Build a per-second frame cache using requestVideoFrameCallback.
  // Playback frame cache via rVFC — fallback only when no Bunny thumbnail API.
  useEffect(() => {
    if (thumbUrlFor) return   // JPEG approach covers this
    const v = videoRef.current
    frameCacheRef.current.clear()
    if (!v?.requestVideoFrameCallback) return

    let lastSec = -1
    const onFrame = (_, meta) => {
      const sec = Math.floor(meta.mediaTime)
      if (sec !== lastSec && !frameCacheRef.current.has(sec)) {
        lastSec = sec
        createImageBitmap(v, { resizeWidth: 160, resizeHeight: 90 })
          .then(bmp => frameCacheRef.current.set(sec, bmp))
          .catch(() => {
            // createImageBitmap with resize options unsupported — fall back to canvas
            const c = document.createElement('canvas')
            c.width = 160; c.height = 90
            try { c.getContext('2d').drawImage(v, 0, 0, 160, 90); frameCacheRef.current.set(sec, c) } catch {}
          })
      }
      rVFCRef.current = v.requestVideoFrameCallback(onFrame)
    }
    rVFCRef.current = v.requestVideoFrameCallback(onFrame)
    return () => {
      if (rVFCRef.current && v.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rVFCRef.current)
        rVFCRef.current = null
      }
    }
  }, [src])

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // While the thumbnail tooltip is visible, poll at ~30 fps to redraw from the
  // JPEG image cache. This makes the thumbnail update the instant a JPEG finishes
  // loading — no extra state, no re-renders needed.
  useEffect(() => {
    if (!thumbUrlFor) return
    let rafId
    const poll = () => {
      const t = hoverTimeRef.current
      if (t !== null) drawFromImgCache(t)
      rafId = requestAnimationFrame(poll)
    }
    rafId = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafId)
  }, [thumbUrlFor, drawFromImgCache])

  // ── Seek / drag ─────────────────────────────────────────────────────────────

  // Seek the hidden thumb video and capture the EXACT frame using
  // requestVideoFrameCallback — fires only when the compositor has the new frame,
  // never before. On rapid hover/drag the previous pending rVFC is cancelled so we
  // never draw a stale frame. After capture, if the user moved further while we were
  // loading, we cascade-seek to the latest requested time.
  const seekThumbTo = useCallback((time) => {
    const tv = thumbVideoRef.current
    if (!tv) return

    hoverTimeRef.current = time
    const requestedTime = time

    // Cancel any previously-registered frame callback before seeking again
    if (thumbRVFCRef.current && tv.cancelVideoFrameCallback) {
      tv.cancelVideoFrameCallback(thumbRVFCRef.current)
      thumbRVFCRef.current = null
    }

    const captureLatest = () => {
      if (hoverTimeRef.current === null) return
      captureFrame(tv)

      const latest = hoverTimeRef.current
      if (latest !== null && Math.abs(tv.currentTime - latest) > 0.35) {
        seekThumbTo(latest)
      }
    }

    const onSeeked = () => {
      if (Math.abs(tv.currentTime - requestedTime) > 0.75) return
      if (tv.requestVideoFrameCallback) {
        thumbRVFCRef.current = tv.requestVideoFrameCallback(() => {
          thumbRVFCRef.current = null
          captureLatest()
        })
      } else {
        captureLatest()
      }
    }

    tv.addEventListener('seeked', onSeeked, { once: true })

    try {
      tv.currentTime = time
    } catch {
      tv.removeEventListener('seeked', onSeeked)
      return
    }

    if (!tv.requestVideoFrameCallback && !thumbSeekPending.current) {
      thumbSeekPending.current = true
      tv.addEventListener('seeked', () => {
        thumbSeekPending.current = false
      }, { once: true })
    }

    if (tv.requestVideoFrameCallback && tv.readyState >= 2 && Math.abs(tv.currentTime - time) < 0.15) {
      thumbRVFCRef.current = tv.requestVideoFrameCallback(() => {
        thumbRVFCRef.current = null
        captureLatest()
      })
    }
  }, [captureFrame])

  // Pure seek — updates video time and progress DOM; no capture side-effects
  const seekFromClientX = useCallback((clientX) => {
    const v    = videoRef.current
    const rect = progressRef.current?.getBoundingClientRect()
    if (!v || !duration || !rect) return

    const pct     = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const newTime = pct * duration
    const pctStr  = `${pct * 100}%`

    v.currentTime = newTime
    hoverTimeRef.current = newTime

    if (fillRef.current)  fillRef.current.style.width = pctStr
    if (thumbRef.current) thumbRef.current.style.left  = pctStr

    setHoverPct(pct * 100)
    setHoverTime(newTime)
  }, [duration])

  const handleProgressHover = (e) => {
    if (isDragging) return
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t   = pct * duration
    const sec = Math.round(t)
    setHoverPct(pct * 100)
    setHoverTime(t)
    hoverTimeRef.current = t
    cancelAnimationFrame(captureAnimRef.current)

    if (thumbUrlFor) {
      // Preload ±20 seconds at 1-second granularity in parallel (each ~10 KB JPEG).
      // Browser loads ~40 images simultaneously in ~20–50 ms total.
      const lo = Math.max(0, sec - 20)
      const hi = Math.min(Math.floor(duration), sec + 20)
      for (let s = lo; s <= hi; s++) preloadImg(s)
      // Draw nearest already-loaded JPEG immediately; exact frame appears as soon as
      // the browser finishes the one small HTTP request (typically <50 ms).
      drawFromImgCache(t)
      // Also register rVFC on thumb video as a precise fallback
      seekThumbTo(t)
    } else {
      if (!drawFromCache(t)) clearThumbnailCanvas()
      seekThumbTo(t)
    }
  }

  const handleProgressClick = useCallback((e) => {
    seekFromClientX(e.clientX)
    seekThumbTo(hoverTimeRef.current ?? 0)
  }, [seekFromClientX, seekThumbTo])

  const clearHoverPreview = useCallback(() => {
    if (isDragging) return
    setHoverTime(null)
    hoverTimeRef.current = null
    thumbHasFrame.current = false
    if (thumbnailRef.current) thumbnailRef.current.style.opacity = '0'
  }, [isDragging])

  const handleDragStart = (e) => {
    e.preventDefault()
    setIsDragging(true)

    const startX = 'clientX' in e ? e.clientX : e.touches[0].clientX
    seekFromClientX(startX)
    seekThumbTo(hoverTimeRef.current ?? 0)   // exact frame via rVFC cascade

    const onMove = (ev) => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX
      seekFromClientX(cx)                // updates hoverTimeRef
      const t   = hoverTimeRef.current
      const sec = Math.round(t ?? 0)
      if (thumbUrlFor) {
        // Preload ±10 seconds around current drag position
        const lo = Math.max(0, sec - 10)
        const hi = Math.min(Math.floor(duration), sec + 10)
        for (let s = lo; s <= hi; s++) preloadImg(s)
        drawFromImgCache(t)
        seekThumbTo(t)
      } else {
        if (!drawFromCache(t)) clearThumbnailCanvas()
        seekThumbTo(t)
      }
    }
    const onUp = () => {
      setIsDragging(false)
      hoverTimeRef.current = null
      // Cancel any pending thumb rVFC so it doesn't fire after drag ends
      const tv = thumbVideoRef.current
      if (thumbRVFCRef.current && tv?.cancelVideoFrameCallback) {
        tv.cancelVideoFrameCallback(thumbRVFCRef.current)
        thumbRVFCRef.current = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend',  onUp)
  }

  // ── Controls ─────────────────────────────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    setShowSettings(false)
    if (v.paused) { v.play().catch(() => {}); setPlaying(true) }
    else          { v.pause(); setPlaying(false) }
  }

  const skip = (secs) => {
    const v = videoRef.current
    if (v) v.currentTime = Math.min(duration, Math.max(0, v.currentTime + secs))
  }

  const handleVolume = (e) => {
    const val = parseFloat(e.target.value)
    setVolume(val); setMuted(val === 0)
    if (videoRef.current) videoRef.current.volume = val
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) el.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

  const togglePip = async () => {
    const v = videoRef.current
    if (!v || !document.pictureInPictureEnabled) return
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); setPipEnabled(false) }
      else                                  { await v.requestPictureInPicture();     setPipEnabled(true)  }
    } catch { setPipEnabled(false) }
  }

  const handleQualityChange = (val) => {
    setQualityValue(val)
    if (hlsRef.current) {
      hlsRef.current.currentLevel = val === 'auto' ? -1 : Number(val)
      if (val === 'auto') {
        setActiveQualityLabel('Auto')
      } else {
        const selected = qualityOptions.find((opt) => opt.value === val)
        if (selected) setActiveQualityLabel(selected.label)
      }
    }
  }

  const requestBuffering = useCallback(() => {
    clearTimeout(bufferingTimerRef.current)
    bufferingTimerRef.current = setTimeout(() => {
      const v = videoRef.current
      if (v && !v.paused && !v.ended && v.readyState < 3) setBuffering(true)
    }, 700)
  }, [])

  const clearBuffering = useCallback(() => {
    clearTimeout(bufferingTimerRef.current)
    setBuffering(false)
  }, [])

  const handleEnded = () => {
    setPlaying(false)
    clearBuffering()
    if (STORAGE_KEY) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(`${STORAGE_KEY}_dur`)
    }
  }

  const resetIdleTimer = useCallback(() => {
    setShowControls(true)
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false)
    }, 3000)
  }, [])

  useEffect(() => () => clearTimeout(idleTimerRef.current), [])
  useEffect(() => () => clearTimeout(bufferingTimerRef.current), [])

  // Sync refs so keyboard handler always has fresh values without stale closures
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { volumeRef.current  = volume  }, [volume])
  useEffect(() => { mutedRef.current   = muted   }, [muted])

  // Persist volume preference across sessions
  useEffect(() => {
    const saved = parseFloat(localStorage.getItem('dhara_vol') ?? '1')
    const v = isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 1
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
  }, [])
  useEffect(() => { localStorage.setItem('dhara_vol', String(volume)) }, [volume])

  // Detect cast / AirPlay capability after video mounts
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    v.disableRemotePlayback = false
    v.setAttribute('x-webkit-airplay', 'allow')

    const hasWebKitAirPlay = typeof v.webkitShowPlaybackTargetPicker === 'function'
    const hasRemotePrompt = v.remote && typeof v.remote.prompt === 'function'

    setCastAvailable(Boolean(hasWebKitAirPlay || hasRemotePrompt))
    setCastConnected(Boolean(v.webkitCurrentPlaybackTargetIsWireless))

    const onWebKitAvailability = (event) => {
      if (event.availability === 'available') setCastAvailable(true)
    }
    const onWebKitTargetChange = () => {
      setCastConnected(Boolean(v.webkitCurrentPlaybackTargetIsWireless))
    }
    const onConnect = () => setCastConnected(true)
    const onDisconnect = () => setCastConnected(false)

    v.addEventListener('webkitplaybacktargetavailabilitychanged', onWebKitAvailability)
    v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWebKitTargetChange)

    if (hasRemotePrompt) {
      v.remote.addEventListener('connect', onConnect)
      v.remote.addEventListener('disconnect', onDisconnect)

      if (typeof v.remote.watchAvailability === 'function') {
        let cancelled = false
        let watchId
        v.remote.watchAvailability((available) => {
          if (!cancelled) setCastAvailable(Boolean(available || hasWebKitAirPlay))
        })
          .then((id) => { watchId = id })
          .catch(() => setCastAvailable(Boolean(hasWebKitAirPlay || hasRemotePrompt)))

        return () => {
          cancelled = true
          if (watchId !== undefined && typeof v.remote.cancelWatchAvailability === 'function') {
            v.remote.cancelWatchAvailability(watchId).catch(() => {})
          }
          v.remote.removeEventListener('connect', onConnect)
          v.remote.removeEventListener('disconnect', onDisconnect)
          v.removeEventListener('webkitplaybacktargetavailabilitychanged', onWebKitAvailability)
          v.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWebKitTargetChange)
        }
      }
    }

    return () => {
      if (hasRemotePrompt) {
        v.remote.removeEventListener('connect', onConnect)
        v.remote.removeEventListener('disconnect', onDisconnect)
      }
      v.removeEventListener('webkitplaybacktargetavailabilitychanged', onWebKitAvailability)
      v.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWebKitTargetChange)
    }
  }, [])

  // Shortcut hint: show a brief overlay label then auto-dismiss
  const showHint = useCallback((text) => {
    setShortcutHint(text)
    clearTimeout(shortcutHintTimer.current)
    shortcutHintTimer.current = setTimeout(() => setShortcutHint(null), 800)
  }, [])

  // Keyboard shortcuts — Space/K play-pause, J/← -10s, L/→ +10s,
  // ↑↓ volume, M mute, F fullscreen, P PiP
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      const v = videoRef.current
      if (!v) return
      switch (e.code) {
        case 'Space': case 'KeyK': {
          e.preventDefault()
          if (v.paused) { v.play().catch(() => {}); setPlaying(true);  showHint('▶') }
          else          { v.pause();                setPlaying(false); showHint('⏸') }
          break
        }
        case 'KeyJ': case 'ArrowLeft': {
          e.preventDefault()
          v.currentTime = Math.max(0, v.currentTime - 10)
          showHint('← 10s')
          break
        }
        case 'KeyL': case 'ArrowRight': {
          e.preventDefault()
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
          showHint('10s →')
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const up = Math.min(1, (mutedRef.current ? 0 : volumeRef.current) + 0.1)
          setVolume(up); setMuted(false); v.volume = up; v.muted = false
          showHint(`Vol ${Math.round(up * 100)}%`)
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const dn = Math.max(0, (mutedRef.current ? 0 : volumeRef.current) - 0.1)
          setVolume(dn); setMuted(dn === 0); v.volume = dn; v.muted = dn === 0
          showHint(`Vol ${Math.round(dn * 100)}%`)
          break
        }
        case 'KeyM': {
          e.preventDefault()
          v.muted = !v.muted; setMuted(v.muted)
          showHint(v.muted ? '🔇' : '🔊')
          break
        }
        case 'KeyF': {
          e.preventDefault()
          if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.()
          else document.exitFullscreen?.()
          break
        }
        case 'KeyP': {
          e.preventDefault()
          if (!document.pictureInPictureEnabled) break
          if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
          else v.requestPictureInPicture().catch(() => {})
          break
        }
        default: break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showHint])

  // Cleanup double-click / double-tap timers on unmount
  useEffect(() => () => {
    clearTimeout(clickTimerRef.current)
    clearTimeout(tapTimerRef.current)
    clearTimeout(shortcutHintTimer.current)
  }, [])

  // Cast / AirPlay
  const handleCast = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (typeof v.webkitShowPlaybackTargetPicker === 'function') {
        v.webkitShowPlaybackTargetPicker()
      } else if (v.remote && typeof v.remote.prompt === 'function') {
        await v.remote.prompt()
      }
    } catch { /* user dismissed */ }
  }

  // Double-click to fullscreen; single-click to play/pause
  const handleVideoAreaClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.()
      else document.exitFullscreen?.()
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null
        togglePlay()
      }, 220)
    }
  }

  // Mobile: double-tap left third = -10s, right third = +10s, centre = play/pause
  const handleTouchEnd = (e) => {
    const v = videoRef.current
    if (!v || !duration) return
    const touch = e.changedTouches[0]
    const rect  = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = (touch.clientX - rect.left) / rect.width

    tapCountRef.current += 1
    clearTimeout(tapTimerRef.current)

    if (tapCountRef.current >= 2) {
      tapCountRef.current = 0
      if (pct < 0.35) {
        v.currentTime = Math.max(0, v.currentTime - 10); showHint('← 10s')
      } else if (pct > 0.65) {
        v.currentTime = Math.min(v.duration, v.currentTime + 10); showHint('10s →')
      } else {
        togglePlay()
      }
    } else {
      tapTimerRef.current = setTimeout(() => {
        if (tapCountRef.current === 1) togglePlay()
        tapCountRef.current = 0
      }, 220)
    }
  }

  const handleRetry = () => {
    setPlayerError('')
    didSeek.current = false
    const v = videoRef.current
    if (!v || !src) return
    cleanupHls()
    v.pause(); v.removeAttribute('src'); v.load()
    setCurrentTime(0); setDuration(0); setBuffered(0)
    setPlaying(false); setBuffering(false); setShowSettings(false)
    queueMicrotask(() => {
      if (isHlsSource(src) && Hls.isSupported()) {
        attachHlsSource(v, src)
      } else if (isHlsSource(src) && v.canPlayType('application/vnd.apple.mpegurl')) {
        attachNativeSource(v, src, 'native-hls')
      } else {
        attachNativeSource(v, src)
      }
    })
  }

  const controlsVisible = showControls || !playing || isDragging
  const arLabel = aspectRatioLabel(videoNaturalSize.w, videoNaturalSize.h)
  const streamBadge = streamMode === 'native-hls'
    ? 'HLS'
    : streamMode === 'hls'
      ? `HLS${activeQualityLabel ? ` · ${activeQualityLabel}` : ''}`
      : ''

  return (
    <div ref={containerRef} className={`${styles.wrapper} ${fullscreen ? styles.fullscreen : ''}`}>
      {/* Hidden video used only for cross-origin thumbnail capture */}
      <video ref={thumbVideoRef} style={{ display: 'none' }} crossOrigin="anonymous" muted playsInline preload="auto" />

      {/* ── Video area ── */}
      <div
        className={styles.videoArea}
        onClick={handleVideoAreaClick}
        onTouchEnd={handleTouchEnd}
        onMouseEnter={() => { setVideoHovered(true); resetIdleTimer() }}
        onMouseLeave={() => { setVideoHovered(false); setShowControls(true); clearTimeout(idleTimerRef.current) }}
        onMouseMove={resetIdleTimer}
      >
        {title && (
          <div className={`${styles.titleOverlay} ${videoHovered ? styles.titleOverlayVisible : ''}`}>
            <p className={styles.titleOverlayText}>{title}</p>
            {streamBadge && (
              <span className={styles.streamBadge}>{streamBadge}</span>
            )}
          </div>
        )}
        <video
          ref={videoRef}
          className={styles.video}
          crossOrigin="anonymous"
          disableRemotePlayback={false}
          x-webkit-airplay="allow"
          poster={poster}
          onLoadedMetadata={(e) => {
            setDuration(e.target.duration)
            setVideoNaturalSize({ w: e.target.videoWidth, h: e.target.videoHeight })
          }}
          onWaiting={requestBuffering}
          onStalled={requestBuffering}
          onPlaying={clearBuffering}
          onCanPlay={clearBuffering}
          onCanPlayThrough={clearBuffering}
          onError={(e) => setPlayerError(mediaErrorMessage(e.currentTarget.error))}
          onTimeUpdate={(e) => {
            clearBuffering()
            setCurrentTime(e.target.currentTime)
            if (e.target.buffered.length) setBuffered(e.target.buffered.end(e.target.buffered.length - 1))
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={handleEnded}
          playsInline
        />

        {!playing && currentTime === 0 && poster && (
          <div className={styles.posterOverlay} style={{ backgroundImage: `url(${poster})` }} aria-hidden="true" />
        )}

        {buffering && !playerError && (
          <div className={styles.bufferingBadge}>
            <Loader2 size={14} className={styles.spin} /> Buffering…
          </div>
        )}

        {shortcutHint && (
          <div key={shortcutHint + Date.now()} className={styles.shortcutHint}>
            {shortcutHint}
          </div>
        )}

        {playerError && (
          <div className={styles.errorOverlay}>
            <p className={styles.errorTitle}>Playback Issue</p>
            <p className={styles.errorSub}>{playerError}</p>
            <button className={styles.retryBtn} onClick={(e) => { e.stopPropagation(); handleRetry() }}>
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        )}

        {/* ── Controls overlay — inside video area ── */}
        <div
          className={`${styles.controlsBar} ${controlsVisible ? styles.controlsVisible : styles.controlsHidden}`}
          onClick={(e) => e.stopPropagation()}
        >
        {/* Progress row */}
        <div className={styles.progressRow}>
          <span className={styles.timeElapsed}>{formatTime(currentTime)}</span>

          <div
            ref={progressRef}
            className={`${styles.progressTrack} ${isDragging ? styles.progressDragging : ''}`}
            onMouseDown={handleDragStart}
            onTouchStart={(e) => { e.preventDefault(); handleDragStart(e.touches[0]) }}
            onMouseMove={handleProgressHover}
            onMouseLeave={clearHoverPreview}
            onClick={handleProgressClick}
            role="slider"
            aria-label="Seek"
            aria-valuenow={Math.round(progress)}
          >
            <div className={styles.progressBuffer} style={{ width: `${bufferPct}%` }} />
            <div ref={fillRef}  className={styles.progressFill}  style={{ width: `${progress}%` }} />
            <div ref={thumbRef} className={`${styles.progressThumb} ${isDragging ? styles.progressThumbDragging : ''}`} style={{ left: `${progress}%` }} />

            {hoverTime !== null && (
              <div
                className={styles.progressTooltip}
                style={{ left: `clamp(80px, ${hoverPct}%, calc(100% - 80px))` }}
              >
                <canvas ref={thumbnailRef} className={styles.thumbnailCanvas} width={160} height={90} />
                <span className={styles.tooltipTime}>{formatTime(hoverTime)}</span>
              </div>
            )}
          </div>

          <span className={styles.timeRemaining}>{duration > 0 ? formatRemaining(remaining) : ''}</span>
        </div>

        {/* Buttons row */}
        <div className={styles.controlRow}>
          {/* Left */}
          <div className={styles.leftControls}>
            <button className={styles.ctrlBtnPrimary} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing
                ? <Pause size={22} fill="currentColor" />
                : <Play  size={22} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button className={styles.ctrlBtn} onClick={() => skip(-10)} aria-label="Rewind 10s">
              <SkipBack size={18} />
            </button>
            <button className={styles.ctrlBtn} onClick={() => skip(10)} aria-label="Forward 10s">
              <SkipForward size={18} />
            </button>

            <div className={styles.volumeGroup}>
              <button className={styles.ctrlBtn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range" min="0" max="1" step="0.05"
                value={muted ? 0 : volume}
                onChange={handleVolume}
                className={styles.volumeSlider}
                aria-label="Volume"
              />
            </div>
          </div>

          {/* Right */}
          <div className={styles.rightControls}>
            {fullscreen && arLabel && (
              <span className={styles.arBadge}>{arLabel}</span>
            )}
            {castAvailable && (
              <button
                className={styles.ctrlBtn}
                onClick={handleCast}
                aria-label={castConnected ? 'Casting — tap to disconnect' : 'Cast to TV or AirPlay'}
                title={castConnected ? 'Casting…' : 'Cast / AirPlay'}
              >
                <Airplay size={18} color={castConnected ? '#f59e0b' : undefined} />
              </button>
            )}
            {document.pictureInPictureEnabled && (
              <button className={styles.ctrlBtn} onClick={togglePip} aria-label="Picture in Picture">
                <PictureInPicture2 size={18} color={pipEnabled ? '#f59e0b' : undefined} />
              </button>
            )}
            <button className={styles.ctrlBtn} onClick={() => setShowSettings((s) => !s)} aria-label="Settings">
              <Settings size={18} />
            </button>
            <button className={styles.ctrlBtn} onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className={styles.settingsPanel}>
            <div className={styles.settingsGroup}>
              <p className={styles.settingsLabel}>Speed</p>
              <div className={styles.settingsChips}>
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    className={`${styles.chipBtn} ${playbackRate === rate ? styles.chipBtnActive : ''}`}
                    onClick={() => setPlaybackRate(rate)}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
            {qualityOptions.length > 0 && (
              <div className={styles.settingsGroup}>
                <p className={styles.settingsLabel}>Quality</p>
                <div className={styles.settingsChips}>
                  <button
                    className={`${styles.chipBtn} ${qualityValue === 'auto' ? styles.chipBtnActive : ''}`}
                    onClick={() => handleQualityChange('auto')}
                  >Auto</button>
                  {qualityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      className={`${styles.chipBtn} ${qualityValue === opt.value ? styles.chipBtnActive : ''}`}
                      onClick={() => handleQualityChange(opt.value)}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>{/* end controlsBar */}
      </div>{/* end videoArea */}
    </div>
  )
}

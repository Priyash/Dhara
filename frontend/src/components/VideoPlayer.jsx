import { useRef, useState, useEffect, useCallback } from 'react'
import Hls from 'hls.js'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Settings, Loader2, RotateCcw, PictureInPicture2,
  Airplay, ArrowLeft, Captions, MonitorPlay,
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

const WATERMARK_POSITIONS = [
  { top: '10%',  left: '6%'  },
  { top: '10%',  right: '6%' },
  { top: '42%',  left: '6%'  },
  { top: '42%',  right: '6%' },
  { bottom: '22%', left: '6%' },
  { bottom: '22%', right: '6%' },
  { top: '10%',  left: '50%', transform: 'translateX(-50%)' },
  { bottom: '22%', left: '50%', transform: 'translateX(-50%)' },
]

export default function VideoPlayer({ src, title, poster, storageKey, maxQualityHeight = null, onPlayingChange, onBack, nextEp, onNextEp, introStart, introEnd, subtitleUrl, isLive, theaterMode, onTheaterToggle, onVideoEnded, watermarkText }) {
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

  // ── "Up next" countdown ─────────────────────────────────────────────────────
  const [showCountdown,  setShowCountdown]  = useState(false)
  const [countdownSecs,  setCountdownSecs]  = useState(10)
  const countdownTimerRef = useRef(null)

  // ── Volume fade-in on first play ────────────────────────────────────────────
  const volumeFadeRef = useRef(null)
  const firstPlayRef  = useRef(true)

  // ── Keyboard shortcut cheat-sheet ───────────────────────────────────────────
  const [showShortcuts,  setShowShortcuts]  = useState(false)
  const showShortcutsRef = useRef(false)

  // ── Double-click / double-tap detection ────────────────────────────────────
  const clickTimerRef = useRef(null)
  const tapCountRef   = useRef(0)
  const tapTimerRef   = useRef(null)

  // ── showHint ref (avoids adding showHint to attachHlsSource deps) ───────────
  const showHintRef = useRef(null)

  // ── Quality switch toast helpers ─────────────────────────────────────────────
  const prevQualityHeightRef = useRef(null)

  // ── Skip intro ───────────────────────────────────────────────────────────────
  const [showSkipIntro, setShowSkipIntro] = useState(false)

  // ── Subtitles / CC ───────────────────────────────────────────────────────────
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false)

  // ── Debug stats overlay ──────────────────────────────────────────────────────
  const [showStats, setShowStats] = useState(false)

  // ── Offline banner ───────────────────────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine)

  // ── Stall detection ──────────────────────────────────────────────────────────
  const stallCountRef   = useRef(0)
  const stallTimerRef   = useRef(null)
  const lastTimeRef     = useRef(null)

  // ── Mobile swipe gestures ────────────────────────────────────────────────────
  const gestureStartRef  = useRef(null)
  const gestureTypeRef   = useRef(null)   // 'seek' | 'volume' | 'brightness' | null
  const gestureBaseRef   = useRef(null)
  const gestureSeekToRef = useRef(null)
  const [gestureIndicator, setGestureIndicator] = useState(null)
  const gestureTimerRef   = useRef(null)
  const [videoBrightness, setVideoBrightness] = useState(1)
  const videoBrightnessRef = useRef(1)
  const longPressTimerRef  = useRef(null)

  // ── Watermark position cycling ───────────────────────────────────────────────
  const [watermarkIdx, setWatermarkIdx] = useState(0)

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

      // Apply plan quality cap: find the highest allowed level index
      if (maxQualityHeight !== null && levels.length > 0) {
        const capIdx = levels.reduce((best, l, i) => {
          return (l.height ?? 0) <= maxQualityHeight ? i : best
        }, -1)
        hls.autoLevelCapping = capIdx >= 0 ? capIdx : 0
      }

      // Only expose capped levels in the quality picker
      const visibleLevels = maxQualityHeight !== null
        ? levels.filter((l) => (l.height ?? 0) <= maxQualityHeight)
        : levels
      setQualityOptions(visibleLevels.map((l, i) => ({ value: String(levels.indexOf(l)), label: qualityLabel(l) })))
      setQualityValue('auto')
      setActiveQualityLabel(visibleLevels.length ? `Auto · ${visibleLevels.length} levels` : 'Auto')

      // Restore saved quality preference
      const savedHeight = parseInt(localStorage.getItem('dhara_quality') || '0')
      if (savedHeight > 0 && (maxQualityHeight === null || savedHeight <= maxQualityHeight)) {
        const targetIdx = levels.findIndex((l) => l.height === savedHeight)
        if (targetIdx >= 0) {
          hls.currentLevel = targetIdx
          setQualityValue(String(targetIdx))
        }
      }

      autoPlayAndResume()
    })

    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      const level = hls.levels?.[data.level]
      if (level) {
        setActiveQualityLabel(qualityLabel(level))
        const newH = level.height
        const prevH = prevQualityHeightRef.current
        if (prevH !== null && prevH !== newH && newH) {
          showHintRef.current?.(`${newH > prevH ? '↑' : '↓'} ${newH}p`)
        }
        prevQualityHeightRef.current = newH ?? null
      }
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
    const onFs = () => setFullscreen(
      Boolean(document.fullscreenElement || document.webkitFullscreenElement)
    )
    // iOS video-level fullscreen fires on the video element, not the document
    const v = videoRef.current
    const onWebKitBegin = () => setFullscreen(true)
    const onWebKitEnd   = () => setFullscreen(false)
    document.addEventListener('fullscreenchange',        onFs)
    document.addEventListener('webkitfullscreenchange',  onFs)
    v?.addEventListener('webkitbeginfullscreen', onWebKitBegin)
    v?.addEventListener('webkitendfullscreen',   onWebKitEnd)
    return () => {
      document.removeEventListener('fullscreenchange',       onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
      v?.removeEventListener('webkitbeginfullscreen', onWebKitBegin)
      v?.removeEventListener('webkitendfullscreen',   onWebKitEnd)
    }
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
    const v  = videoRef.current
    if (!el) return
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement)
    if (!isFs) {
      // Standard → webkit prefixed → iOS video-level fallback
      if      (el.requestFullscreen)            el.requestFullscreen()
      else if (el.webkitRequestFullscreen)      el.webkitRequestFullscreen()
      else if (v?.webkitEnterFullscreen)        v.webkitEnterFullscreen()
    } else {
      if      (document.exitFullscreen)         document.exitFullscreen()
      else if (document.webkitExitFullscreen)   document.webkitExitFullscreen()
    }
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
        localStorage.removeItem('dhara_quality')
      } else {
        const selected = qualityOptions.find((opt) => opt.value === val)
        if (selected) setActiveQualityLabel(selected.label)
        const level = hlsRef.current.levels?.[Number(val)]
        if (level?.height) localStorage.setItem('dhara_quality', String(level.height))
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
    onPlayingChange?.(false)
    clearBuffering()
    if (STORAGE_KEY) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(`${STORAGE_KEY}_dur`)
    }
    if (nextEp && onNextEp) {
      setCountdownSecs(10)
      setShowCountdown(true)
      countdownTimerRef.current = setInterval(() => {
        setCountdownSecs((s) => {
          if (s <= 1) {
            clearInterval(countdownTimerRef.current)
            setShowCountdown(false)
            onNextEp()
            return 10
          }
          return s - 1
        })
      }, 1000)
    } else {
      onVideoEnded?.()
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
  useEffect(() => { playingRef.current       = playing      }, [playing])
  useEffect(() => { volumeRef.current        = volume       }, [volume])
  useEffect(() => { mutedRef.current         = muted        }, [muted])
  useEffect(() => { showShortcutsRef.current = showShortcuts }, [showShortcuts])

  // Reset per-src state when source changes
  useEffect(() => {
    firstPlayRef.current = true
    setShowCountdown(false)
    setCountdownSecs(10)
    clearInterval(countdownTimerRef.current)
  }, [src])

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

  // Sync showHint into a ref so HLS event handlers can call it without stale closures
  useEffect(() => { showHintRef.current = showHint }, [showHint])

  // Cycle watermark position every 8 s (fade out → reposition → fade in via CSS animation + key)
  useEffect(() => {
    if (!watermarkText) return
    const t = setInterval(() => setWatermarkIdx((i) => (i + 1) % WATERMARK_POSITIONS.length), 8000)
    return () => clearInterval(t)
  }, [watermarkText])

  // Gesture indicator: show a brief label then auto-dismiss
  const showGestureIndicator = useCallback((text) => {
    setGestureIndicator(text)
    clearTimeout(gestureTimerRef.current)
    gestureTimerRef.current = setTimeout(() => setGestureIndicator(null), 1200)
  }, [])

  // Online / offline banner
  useEffect(() => {
    const onOnline  = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Subtitle track mode
  useEffect(() => {
    const v = videoRef.current
    if (!v || !subtitleUrl) return
    for (const track of Array.from(v.textTracks)) {
      track.mode = subtitlesEnabled ? 'showing' : 'hidden'
    }
  }, [subtitleUrl, subtitlesEnabled])

  // Stall detection: 3 consecutive frozen-frame checks → recover
  useEffect(() => {
    stallTimerRef.current = setInterval(() => {
      const v = videoRef.current
      if (!v || v.paused || v.ended || !hlsRef.current) return
      const t = v.currentTime
      if (t === lastTimeRef.current && v.readyState < 3) {
        stallCountRef.current += 1
        if (stallCountRef.current >= 3) {
          stallCountRef.current = 0
          showHintRef.current?.('Reconnecting…')
          hlsRef.current.recoverMediaError()
        }
      } else {
        stallCountRef.current = 0
      }
      lastTimeRef.current = t
    }, 3000)
    return () => clearInterval(stallTimerRef.current)
  }, [])

  // Skip intro: show button when currentTime is inside intro window
  useEffect(() => {
    if (introStart == null || introEnd == null) { setShowSkipIntro(false); return }
    setShowSkipIntro(currentTime >= introStart && currentTime < introEnd)
  }, [currentTime, introStart, introEnd])

  // Persist playback speed across sessions
  useEffect(() => {
    const saved = parseFloat(localStorage.getItem('dhara_speed') || '1')
    const valid = [0.75, 1, 1.25, 1.5, 2].includes(saved) ? saved : 1
    setPlaybackRate(valid)
  }, [])
  useEffect(() => { localStorage.setItem('dhara_speed', String(playbackRate)) }, [playbackRate])

  // Keyboard shortcuts — Space/K play-pause, J/← -10s, L/→ +10s,
  // ↑↓ volume, M mute, F fullscreen, P PiP
  useEffect(() => {
    const onKey = (e) => {
      // Block browser save-page / view-source shortcuts while the player is mounted
      if ((e.ctrlKey || e.metaKey) && 'su'.includes(e.key.toLowerCase())) {
        e.preventDefault()
        return
      }
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
          toggleFullscreen()
          break
        }
        case 'KeyP': {
          e.preventDefault()
          if (!document.pictureInPictureEnabled) break
          if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
          else v.requestPictureInPicture().catch(() => {})
          break
        }
        case 'KeyT': {
          e.preventDefault()
          onTheaterToggle?.()
          break
        }
        case 'KeyI': {
          if (!e.shiftKey) break
          e.preventDefault()
          setShowStats((s) => !s)
          break
        }
        case 'Escape': {
          setShowSettings(false)
          setShowShortcuts(false)
          setShowStats(false)
          break
        }
        default:
          if (e.key === '?') {
            e.preventDefault()
            setShowShortcuts((s) => !s)
          }
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showHint])

  // Cleanup timers on unmount
  useEffect(() => () => {
    clearTimeout(clickTimerRef.current)
    clearTimeout(tapTimerRef.current)
    clearTimeout(shortcutHintTimer.current)
    clearInterval(countdownTimerRef.current)
    clearInterval(stallTimerRef.current)
    clearTimeout(gestureTimerRef.current)
    clearTimeout(longPressTimerRef.current)
    if (volumeFadeRef.current) cancelAnimationFrame(volumeFadeRef.current)
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

  // Mobile swipe gestures: vertical on left half = brightness, right half = volume, horizontal = seek
  const handleTouchStartPlayer = (e) => {
    resetIdleTimer()
    const touch = e.touches[0]
    gestureStartRef.current = { x: touch.clientX, y: touch.clientY }
    gestureTypeRef.current  = null
    gestureBaseRef.current  = null
    gestureSeekToRef.current = null

    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30)
      setShowStats((s) => !s)
      gestureTypeRef.current = 'longpress'
    }, 2000)
  }

  const handleTouchMovePlayer = (e) => {
    const start = gestureStartRef.current
    if (!start) return
    const touch = e.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) clearTimeout(longPressTimerRef.current)

    if (!gestureTypeRef.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      const rect = containerRef.current?.getBoundingClientRect()
      const isLeft = rect && (touch.clientX - rect.left) / rect.width < 0.5
      if (Math.abs(dx) > Math.abs(dy) * 1.3) {
        gestureTypeRef.current = 'seek'
        gestureBaseRef.current = videoRef.current?.currentTime ?? 0
      } else if (isLeft) {
        gestureTypeRef.current = 'brightness'
        gestureBaseRef.current = videoBrightnessRef.current
      } else {
        gestureTypeRef.current = 'volume'
        gestureBaseRef.current = mutedRef.current ? 0 : volumeRef.current
      }
    }

    const type = gestureTypeRef.current
    const base = gestureBaseRef.current
    const rect = containerRef.current?.getBoundingClientRect()
    if (!type || base === null || !rect || type === 'longpress') return

    if (type === 'seek') {
      const seekDelta = (dx / rect.width) * (videoRef.current?.duration || 0)
      const newTime = Math.max(0, Math.min(videoRef.current?.duration || 0, base + seekDelta))
      gestureSeekToRef.current = newTime
      const diff = Math.round(seekDelta)
      showGestureIndicator(diff >= 0 ? `+${diff}s` : `${diff}s`)
    } else if (type === 'brightness') {
      const nb = Math.max(0.1, Math.min(2, base - (dy / rect.height) * 2))
      videoBrightnessRef.current = nb
      setVideoBrightness(nb)
      showGestureIndicator(`☀ ${Math.round(nb * 100)}%`)
    } else if (type === 'volume') {
      const nv = Math.max(0, Math.min(1, base - (dy / rect.height) * 1.5))
      setVolume(nv); setMuted(nv === 0)
      if (videoRef.current) { videoRef.current.volume = nv; videoRef.current.muted = nv === 0 }
      showGestureIndicator(`🔊 ${Math.round(nv * 100)}%`)
    }
  }

  const handleTouchEndPlayer = (e) => {
    clearTimeout(longPressTimerRef.current)
    const type = gestureTypeRef.current
    gestureTypeRef.current  = null
    gestureStartRef.current = null
    gestureBaseRef.current  = null

    if (type === 'seek') {
      const seekTo = gestureSeekToRef.current
      gestureSeekToRef.current = null
      if (seekTo !== null && videoRef.current) {
        videoRef.current.currentTime = seekTo
        if (navigator.vibrate) navigator.vibrate(15)
      }
      return
    }
    if (type === 'brightness' || type === 'volume') {
      if (navigator.vibrate) navigator.vibrate(15)
      return
    }
    if (type === 'longpress') return

    // Tap / double-tap
    resetIdleTimer()
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
        v.currentTime = Math.max(0, v.currentTime - 10)
        showHint('← 10s')
        if (navigator.vibrate) navigator.vibrate(15)
      } else if (pct > 0.65) {
        v.currentTime = Math.min(v.duration, v.currentTime + 10)
        showHint('10s →')
        if (navigator.vibrate) navigator.vibrate(15)
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

  return (
    <div ref={containerRef} className={`${styles.wrapper} ${fullscreen ? styles.fullscreen : ''}`}>
      {/* Ambient glow — blurred poster bleeds around the player when paused */}
      {poster && !fullscreen && (
        <div
          className={`${styles.ambientGlow} ${!playing ? styles.ambientGlowVisible : ''}`}
          style={{ backgroundImage: `url(${poster})` }}
          aria-hidden="true"
        />
      )}
      {/* Hidden video used only for cross-origin thumbnail capture */}
      <video ref={thumbVideoRef} style={{ display: 'none' }} crossOrigin="anonymous" muted playsInline preload="auto" />

      {/* ── Video area ── */}
      <div
        className={styles.videoArea}
        onClick={handleVideoAreaClick}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={handleTouchStartPlayer}
        onTouchMove={handleTouchMovePlayer}
        onTouchEnd={handleTouchEndPlayer}
        onMouseEnter={() => { setVideoHovered(true); resetIdleTimer() }}
        onMouseLeave={() => { setVideoHovered(false); setShowControls(true); clearTimeout(idleTimerRef.current) }}
        onMouseMove={resetIdleTimer}
      >
        {/* Back button + title — visible whenever controls are visible */}
        {(onBack || title) && (
          <div className={`${styles.titleOverlay} ${controlsVisible ? styles.titleOverlayVisible : ''}`}>
            {onBack && (
              <button
                className={styles.backOverlayBtn}
                onClick={(e) => { e.stopPropagation(); onBack() }}
                aria-label="Go back"
              >
                <ArrowLeft size={16} />
                <span className={styles.backOverlayText}>Back</span>
              </button>
            )}
            {title && <p className={styles.titleOverlayText}>{title}</p>}
          </div>
        )}

        {/* Large center play button — shown when paused */}
        {!playing && !playerError && (
          <button
            className={styles.centerPlayBtn}
            onClick={(e) => { e.stopPropagation(); togglePlay() }}
            onTouchEnd={(e) => e.stopPropagation()}
            aria-label="Play"
          >
            <Play size={32} fill="currentColor" style={{ marginLeft: 3 }} />
          </button>
        )}
        <video
          ref={videoRef}
          className={styles.video}
          crossOrigin="anonymous"
          disableRemotePlayback={false}
          x-webkit-airplay="allow"
          controlsList="nodownload"
          onContextMenu={(e) => e.preventDefault()}
          poster={poster}
          style={videoBrightness !== 1 ? { filter: `brightness(${videoBrightness})` } : undefined}
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
          onPlay={() => {
            setPlaying(true)
            onPlayingChange?.(true)
            if (firstPlayRef.current && !mutedRef.current) {
              firstPlayRef.current = false
              const v = videoRef.current
              if (v) {
                const target = volumeRef.current
                v.volume = 0
                let start = null
                const tick = (ts) => {
                  if (!start) start = ts
                  const pct = Math.min(1, (ts - start) / 350)
                  if (videoRef.current) videoRef.current.volume = target * pct
                  if (pct < 1) volumeFadeRef.current = requestAnimationFrame(tick)
                }
                volumeFadeRef.current = requestAnimationFrame(tick)
              }
            } else {
              firstPlayRef.current = false
            }
          }}
          onPause={() => {
            setPlaying(false)
            onPlayingChange?.(false)
            if (volumeFadeRef.current) { cancelAnimationFrame(volumeFadeRef.current); volumeFadeRef.current = null }
          }}
          onEnded={handleEnded}
          playsInline
        >
          {subtitleUrl && (
            <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} />
          )}
        </video>

        {!playing && currentTime === 0 && poster && (
          <div className={styles.posterOverlay} style={{ backgroundImage: `url(${poster})` }} aria-hidden="true" />
        )}

        {buffering && !playerError && (
          <div className={styles.bufferingBadge}>
            <Loader2 size={14} className={styles.spin} /> Buffering…
          </div>
        )}

        {/* Casting ribbon — shown at top when AirPlay / Cast is active */}
        {castConnected && (
          <div className={styles.castingRibbon}>
            <Airplay size={14} />
            <span>Casting to TV</span>
            <button
              className={styles.castingStopBtn}
              onClick={(e) => { e.stopPropagation(); handleCast() }}
            >
              Stop
            </button>
          </div>
        )}

        {/* Offline banner */}
        {isOffline && (
          <div className={styles.offlineRibbon} aria-live="assertive">
            No internet connection — playback may stall
          </div>
        )}

        {/* Skip Intro button */}
        {showSkipIntro && (
          <button
            className={styles.skipIntroBtn}
            onClick={(e) => { e.stopPropagation(); if (videoRef.current && introEnd != null) videoRef.current.currentTime = introEnd }}
          >
            Skip Intro ›
          </button>
        )}

        {/* Swipe gesture indicator */}
        {gestureIndicator && (
          <div className={styles.gestureIndicator} aria-hidden="true">{gestureIndicator}</div>
        )}

        {/* Debug stats overlay — Shift+I or 2s long-press */}
        {showStats && (
          <div className={styles.statsOverlay} onClick={(e) => e.stopPropagation()}>
            <div className={styles.statRow}><span className={styles.statKey}>Resolution</span><span className={styles.statVal}>{videoNaturalSize.w > 0 ? `${videoNaturalSize.w}×${videoNaturalSize.h}` : '—'}</span></div>
            <div className={styles.statRow}><span className={styles.statKey}>Quality</span><span className={styles.statVal}>{activeQualityLabel || '—'}</span></div>
            <div className={styles.statRow}><span className={styles.statKey}>Buffer</span><span className={styles.statVal}>{Math.max(0, Math.round((buffered - currentTime) * 10) / 10)}s ahead</span></div>
            <div className={styles.statRow}><span className={styles.statKey}>Speed</span><span className={styles.statVal}>{playbackRate}×</span></div>
            <div className={styles.statRow}><span className={styles.statKey}>Mode</span><span className={styles.statVal}>{streamMode || '—'}</span></div>
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

        {/* Invisible drifting watermark — embeds user identity in screen recordings */}
        {watermarkText && (
          <div
            key={watermarkIdx}
            className={styles.watermark}
            style={WATERMARK_POSITIONS[watermarkIdx]}
            aria-hidden="true"
          >
            {watermarkText}
          </div>
        )}

        {/* ── Controls overlay — inside video area ── */}
        <div
          className={`${styles.controlsBar} ${controlsVisible ? styles.controlsVisible : styles.controlsHidden}`}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
        {/* Progress row */}
        <div className={styles.progressRow}>
          <span className={styles.timeElapsed}>{formatTime(currentTime)}</span>
          {playbackRate !== 1 && (
            <span className={styles.speedBadge}>{playbackRate}×</span>
          )}

          <div
            ref={progressRef}
            className={`${styles.progressTrack} ${isDragging ? styles.progressDragging : ''}`}
            onMouseDown={handleDragStart}
            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); handleDragStart(e.touches[0]) }}
            onTouchEnd={(e) => e.stopPropagation()}
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
            {duration > 600 && Array.from({ length: 9 }, (_, i) => (
              <div key={i} className={styles.chapterMark} style={{ left: `${(i + 1) * 10}%` }} />
            ))}

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

          {isLive ? (
            <div className={styles.livePill}>
              <span className={styles.liveDot} aria-hidden="true" />
              LIVE
            </div>
          ) : (
            <span className={styles.timeRemaining}>{duration > 0 ? formatRemaining(remaining) : ''}</span>
          )}
          {isLive && duration > 0 && remaining > 30 && (
            <button
              className={styles.goLiveBtn}
              onClick={(e) => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime = videoRef.current.duration }}
            >
              Go Live
            </button>
          )}
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
            {subtitleUrl && (
              <button
                className={`${styles.ctrlBtn} ${subtitlesEnabled ? styles.ctrlBtnActive : ''}`}
                onClick={() => setSubtitlesEnabled((s) => !s)}
                aria-label={subtitlesEnabled ? 'Disable subtitles' : 'Enable subtitles'}
                title="Subtitles / CC"
              >
                <Captions size={18} />
              </button>
            )}
            {onTheaterToggle && (
              <button
                className={`${styles.ctrlBtn} ${theaterMode ? styles.ctrlBtnActive : ''}`}
                onClick={(e) => { e.stopPropagation(); onTheaterToggle() }}
                aria-label={theaterMode ? 'Exit theater mode' : 'Theater mode'}
                title="Theater mode (T)"
              >
                <MonitorPlay size={18} />
              </button>
            )}
            {castAvailable && (
              <button
                className={styles.ctrlBtn}
                onClick={handleCast}
                aria-label={castConnected ? 'Casting — tap to disconnect' : 'Cast to TV or AirPlay'}
                title={castConnected ? 'Casting…' : 'Cast / AirPlay'}
              >
                <Airplay size={18} color={castConnected ? '#db2777' : undefined} />
              </button>
            )}
            {document.pictureInPictureEnabled && (
              <button className={styles.ctrlBtn} onClick={togglePip} aria-label="Picture in Picture">
                <PictureInPicture2 size={18} color={pipEnabled ? '#db2777' : undefined} />
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

        </div>{/* end controlsBar */}

        {/* "Up next" episode countdown — bottom-right, appears after video ends */}
        {showCountdown && nextEp && (
          <div
            className={styles.countdownOverlay}
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className={styles.countdownInner}>
              <p className={styles.countdownLabel}>Up Next</p>
              <p className={styles.countdownTitle}>
                E{nextEp.number}{nextEp.title ? ` · ${nextEp.title}` : ''}
              </p>
              <div className={styles.countdownTimer}>
                <svg className={styles.countdownRing} viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                  <circle
                    cx="18" cy="18" r="15" fill="none"
                    stroke="#db2777" strokeWidth="2.5" strokeLinecap="round"
                    strokeDasharray={`${(countdownSecs / 10) * 94.25} 94.25`}
                    transform="rotate(-90 18 18)"
                  />
                  <text x="18" y="22.5" textAnchor="middle" className={styles.countdownNum}>{countdownSecs}</text>
                </svg>
              </div>
              <div className={styles.countdownBtnGroup}>
                <button
                  className={styles.countdownPlayNow}
                  onClick={() => { clearInterval(countdownTimerRef.current); setShowCountdown(false); onNextEp() }}
                >
                  Play Now
                </button>
                <button
                  className={styles.countdownCancel}
                  onClick={() => { clearInterval(countdownTimerRef.current); setShowCountdown(false) }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Keyboard shortcut cheat-sheet — press ? to toggle */}
        {showShortcuts && (
          <div
            className={styles.shortcutsOverlay}
            onClick={(e) => { e.stopPropagation(); setShowShortcuts(false) }}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className={styles.shortcutsPanel} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.shortcutsTitle}>Keyboard Shortcuts</h3>
              <div className={styles.shortcutsGrid}>
                {[
                  { keys: ['Space', 'K'], action: 'Play / Pause'       },
                  { keys: ['J', '←'],     action: 'Rewind 10s'         },
                  { keys: ['L', '→'],     action: 'Forward 10s'        },
                  { keys: ['↑', '↓'],     action: 'Volume'             },
                  { keys: ['M'],           action: 'Mute'               },
                  { keys: ['F'],           action: 'Fullscreen'         },
                  { keys: ['T'],           action: 'Theater mode'       },
                  { keys: ['P'],           action: 'Picture in Picture' },
                  { keys: ['Shift+I'],     action: 'Debug stats'        },
                  { keys: ['?'],           action: 'Close this panel'   },
                ].map(({ keys, action }) => (
                  <div key={action} className={styles.shortcutRow}>
                    <div className={styles.shortcutKeys}>
                      {keys.map((k) => <kbd key={k} className={styles.kbdKey}>{k}</kbd>)}
                    </div>
                    <span className={styles.shortcutAction}>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Settings panel — anchored to videoArea, not controlsBar, so
            position stays consistent across all aspect ratios and screen sizes */}
        {showSettings && controlsVisible && (
          <div className={styles.settingsPanel} onClick={(e) => e.stopPropagation()}>
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
      </div>{/* end videoArea */}
    </div>
  )
}

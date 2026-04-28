import { useRef, useState, useEffect, useCallback } from 'react'
import Hls from 'hls.js'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Settings, Loader2, RotateCcw, PictureInPicture2,
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
  const captureAnimRef= useRef(null)

  const [playing,        setPlaying]        = useState(false)
  const [currentTime,    setCurrentTime]    = useState(0)
  const [duration,       setDuration]       = useState(0)
  const [volume,         setVolume]         = useState(1)
  const [muted,          setMuted]          = useState(false)
  const [fullscreen,     setFullscreen]     = useState(false)
  const [buffered,       setBuffered]       = useState(0)
  const [buffering,      setBuffering]      = useState(false)
  const [showSettings,   setShowSettings]   = useState(false)
  const [playbackRate,   setPlaybackRate]   = useState(1)
  const [qualityOptions, setQualityOptions] = useState([])
  const [qualityValue,   setQualityValue]   = useState('auto')
  const [playerError,    setPlayerError]    = useState('')
  const [pipEnabled,     setPipEnabled]     = useState(false)
  const [hoverTime,      setHoverTime]      = useState(null)
  const [hoverPct,       setHoverPct]       = useState(0)
  const [isDragging,     setIsDragging]     = useState(false)
  const [videoHovered,   setVideoHovered]   = useState(false)

  const progress  = duration ? (currentTime / duration) * 100 : 0
  const bufferPct = duration ? (buffered  / duration) * 100 : 0
  const remaining = duration - currentTime

  const STORAGE_KEY = storageKey ? `dhara_progress_${storageKey}` : null

  const saveProgress = useCallback(() => {
    if (!STORAGE_KEY || !videoRef.current) return
    const t = videoRef.current.currentTime
    if (t > 5) localStorage.setItem(STORAGE_KEY, String(t))
  }, [STORAGE_KEY])

  const qualityLabel = (level) => {
    const h    = level?.height ? `${level.height}p` : 'Auto'
    const kbps = level?.bitrate ? Math.round(level.bitrate / 1000) : null
    return kbps ? `${h} · ${kbps}kbps` : h
  }

  const captureFrame = useCallback(() => {
    const canvas = thumbnailRef.current
    const video  = videoRef.current
    if (!canvas || !video || video.readyState < 2) return
    try {
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch { /* cross-origin taint — keep previous frame */ }
  }, [])

  const cleanupHls = () => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
  }

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

  useEffect(() => {
    const v = videoRef.current
    if (!src || !v) return
    setPlayerError('')
    setQualityOptions([])
    setQualityValue('auto')
    didSeek.current = false
    cleanupHls()

    if (src.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 })
        hls.loadSource(src)
        hls.attachMedia(v)
        hlsRef.current = hls
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setQualityOptions((data.levels || []).map((l, i) => ({ value: String(i), label: qualityLabel(l) })))
          setQualityValue('auto')
          autoPlayAndResume()
        })
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR)   { hls.recoverMediaError(); return }
          setPlayerError('Playback failed. Please retry.')
        })
        return cleanupHls
      }
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = src
        v.addEventListener('loadedmetadata', autoPlayAndResume, { once: true })
        return undefined
      }
      setPlayerError('This browser cannot play HLS streams.')
      return undefined
    }
    v.src = src
    v.addEventListener('loadedmetadata', autoPlayAndResume, { once: true })
    return undefined
  }, [src, autoPlayAndResume])

  useEffect(() => {
    if (playing) {
      saveTimer.current = setInterval(saveProgress, 10_000)
    } else {
      clearInterval(saveTimer.current)
      saveProgress()
    }
    return () => clearInterval(saveTimer.current)
  }, [playing, saveProgress])

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // ── Seek / drag ─────────────────────────────────────────────────────────────
  const seekFromClientX = useCallback((clientX) => {
    const v    = videoRef.current
    const rect = progressRef.current?.getBoundingClientRect()
    if (!v || !duration || !rect) return

    const pct     = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const newTime = pct * duration
    const pctStr  = `${pct * 100}%`

    // Direct video seek — no wait for React
    v.currentTime = newTime

    // Direct DOM update for fill + thumb — zero re-renders during drag
    if (fillRef.current)  fillRef.current.style.width = pctStr
    if (thumbRef.current) thumbRef.current.style.left  = pctStr

    // Tooltip + thumbnail capture
    setHoverPct(pct * 100)
    setHoverTime(newTime)
    cancelAnimationFrame(captureAnimRef.current)
    captureAnimRef.current = requestAnimationFrame(captureFrame)
  }, [duration, captureFrame])

  const handleProgressHover = (e) => {
    if (isDragging) return
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverPct(pct * 100)
    setHoverTime(pct * duration)
    cancelAnimationFrame(captureAnimRef.current)
    captureAnimRef.current = requestAnimationFrame(captureFrame)
  }

  const handleDragStart = (e) => {
    e.preventDefault()
    setIsDragging(true)
    seekFromClientX('clientX' in e ? e.clientX : e.touches[0].clientX)

    const onMove = (ev) => seekFromClientX(ev.touches ? ev.touches[0].clientX : ev.clientX)
    const onUp   = () => {
      setIsDragging(false)
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
    if (hlsRef.current) hlsRef.current.currentLevel = val === 'auto' ? -1 : Number(val)
  }

  const handleEnded = () => {
    setPlaying(false)
    if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY)
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
      if (src.endsWith('.m3u8') && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 })
        hls.loadSource(src); hls.attachMedia(v)
        hlsRef.current = hls
        hls.on(Hls.Events.MANIFEST_PARSED, () => autoPlayAndResume())
      } else {
        v.src = src
        v.addEventListener('loadedmetadata', autoPlayAndResume, { once: true })
      }
    })
  }

  return (
    <div ref={containerRef} className={`${styles.wrapper} ${fullscreen ? styles.fullscreen : ''}`}>
      {/* ── Video area ── */}
      <div
        className={styles.videoArea}
        onClick={togglePlay}
        onMouseEnter={() => setVideoHovered(true)}
        onMouseLeave={() => setVideoHovered(false)}
      >
        {title && (
          <div className={`${styles.titleOverlay} ${videoHovered ? styles.titleOverlayVisible : ''}`}>
            <p className={styles.titleOverlayText}>{title}</p>
          </div>
        )}
        <video
          ref={videoRef}
          className={styles.video}
          poster={poster}
          onLoadedMetadata={(e) => setDuration(e.target.duration)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onTimeUpdate={(e) => {
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

        {playerError && (
          <div className={styles.errorOverlay}>
            <p className={styles.errorTitle}>Playback Issue</p>
            <p className={styles.errorSub}>{playerError}</p>
            <button className={styles.retryBtn} onClick={(e) => { e.stopPropagation(); handleRetry() }}>
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        )}
      </div>

      {/* ── Controls bar — always below video ── */}
      <div className={styles.controlsBar}>
        {/* Progress row */}
        <div className={styles.progressRow}>
          <span className={styles.timeElapsed}>{formatTime(currentTime)}</span>

          <div
            ref={progressRef}
            className={`${styles.progressTrack} ${isDragging ? styles.progressDragging : ''}`}
            onMouseDown={handleDragStart}
            onTouchStart={(e) => { e.preventDefault(); handleDragStart(e.touches[0]) }}
            onMouseMove={handleProgressHover}
            onMouseLeave={() => { if (!isDragging) setHoverTime(null) }}
            onClick={(e) => seekFromClientX(e.clientX)}
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
      </div>
    </div>
  )
}

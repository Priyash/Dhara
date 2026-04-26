import { useRef, useState, useEffect, useCallback } from 'react'
import Hls from 'hls.js'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Settings, X,
} from 'lucide-react'
import styles from './VideoPlayer.module.css'

function formatTime(secs) {
  if (!isFinite(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/**
 * VideoPlayer — drop in a `src` (HLS .m3u8 or MP4) and a `title`.
 * For HLS, install hls.js: `npm install hls.js`
 * and uncomment the HLS block below.
 */
export default function VideoPlayer({ src, title, onClose, poster }) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const hideTimer = useRef(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [buffered, setBuffered] = useState(0)

  // Attach HLS.js for adaptive streaming (.m3u8); fall back to native src for Safari.
  useEffect(() => {
    const v = videoRef.current
    if (!src || !v) return

    if (src.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hls.loadSource(src)
        hls.attachMedia(v)
        return () => hls.destroy()
      }
      // Safari has native HLS support
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = src
      }
    } else {
      v.src = src
    }
  }, [src])

  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (playing) setShowControls(false)
    }, 3000)
  }, [playing])

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else          { v.pause(); setPlaying(false) }
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    setCurrentTime(v.currentTime)
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
  }

  const handleSeek = (e) => {
    const v = videoRef.current
    if (!v || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    v.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const skip = (secs) => {
    const v = videoRef.current
    if (v) v.currentTime = Math.min(duration, Math.max(0, v.currentTime + secs))
  }

  const handleVolume = (e) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (videoRef.current) videoRef.current.volume = val
    setMuted(val === 0)
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
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
      setFullscreen(true)
    } else {
      document.exitFullscreen?.()
      setFullscreen(false)
    }
  }

  const progress = duration ? (currentTime / duration) * 100 : 0
  const bufferPct = duration ? (buffered / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      className={`${styles.player} ${!showControls && playing ? styles.hideCursor : ''}`}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => playing && setShowControls(false)}
      onClick={togglePlay}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className={styles.video}
        poster={poster}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        playsInline
      />

      {/* Poster overlay when paused at start */}
      {!playing && currentTime === 0 && poster && (
        <div className={styles.posterOverlay} style={{ backgroundImage: `url(${poster})` }} aria-hidden="true" />
      )}

      {/* Controls overlay */}
      <div
        className={`${styles.controls} ${showControls ? styles.controlsVisible : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className={styles.topBar}>
          <h2 className={styles.videoTitle}>{title}</h2>
          {onClose && (
            <button className={styles.ctrlBtn} onClick={onClose} aria-label="Close player">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Bottom controls */}
        <div className={styles.bottomBar}>
          {/* Progress bar */}
          <div className={styles.progressTrack} onClick={handleSeek} role="slider" aria-label="Seek" aria-valuenow={Math.round(progress)}>
            <div className={styles.progressBuffer} style={{ width: `${bufferPct}%` }} />
            <div className={styles.progressFill}   style={{ width: `${progress}%` }} />
            <div className={styles.progressThumb}  style={{ left:  `${progress}%` }} />
          </div>

          {/* Control row */}
          <div className={styles.controlRow}>
            {/* Left: play, skip, volume */}
            <div className={styles.leftControls}>
              <button className={styles.ctrlBtn} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />}
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

              <span className={styles.timeDisplay}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* Right: settings, fullscreen */}
            <div className={styles.rightControls}>
              <button className={styles.ctrlBtn} aria-label="Settings">
                <Settings size={18} />
              </button>
              <button className={styles.ctrlBtn} onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState, useRef, memo } from 'react'
import Hls from 'hls.js'
import { Crown, Star } from 'lucide-react'
import { cloudinaryTransform } from '../services/cloudinary'
import { fetchTrailerUrl, recordInteractionEvent } from '../services/api'
import styles from './PosterCard.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

function PosterCard({ item, onClick, size = 'normal', isSubscribed = false, source = 'row' }) {
  const [imgError,    setImgError]    = useState(false)
  const [trailerSrc,  setTrailerSrc]  = useState(null)
  const hoverTimer = useRef(null)
  const videoRef   = useRef(null)
  const hlsRef     = useRef(null)
  const cardRef    = useRef(null)
  const impressionSentRef = useRef(false)

  useEffect(() => {
    const id = item?._id || item?.id
    const el = cardRef.current
    if (!id || !el || impressionSentRef.current || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || impressionSentRef.current) return
      impressionSentRef.current = true
      recordInteractionEvent({ itemId: id, eventType: 'impression', source }).catch(() => {})
      observer.disconnect()
    }, { threshold: [0.5] })

    observer.observe(el)
    return () => observer.disconnect()
  }, [item, source])

  const startTrailer = async () => {
    if (!item.trailerVideoId) return
    try {
      const { hlsUrl } = await fetchTrailerUrl(item._id || item.id)
      if (!hlsUrl) return
      setTrailerSrc(hlsUrl)
    } catch {}
  }

  const handleMouseEnter = () => {
    hoverTimer.current = setTimeout(startTrailer, 700)
  }

  const handleMouseLeave = () => {
    clearTimeout(hoverTimer.current)
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    setTrailerSrc(null)
  }

  // Wire up HLS when trailerSrc is set
  const onVideoRef = (el) => {
    videoRef.current = el
    if (!el || !trailerSrc) return
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = trailerSrc
    } else if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 10, startLevel: 0 })
      hls.loadSource(trailerSrc)
      hls.attachMedia(el)
      hlsRef.current = hls
    }
  }

  const posterSrc = item.posterUrl && !imgError
    ? cloudinaryTransform(item.posterUrl, 'w_400,h_600,c_fill,g_auto,f_auto,q_auto')
    : null

  const cleanTitle  = stripExtension(item.title)
  const genres      = (item.genre || []).slice(0, 2)
  const episodeInfo = (item.type === 'Series' || item.type === 'Serial Drama') && item.episodes?.length
    ? `${item.episodes.length} Ep`
    : null

  const progress     = item._progress
  const progressPct  = progress?.durationSecs > 0
    ? Math.min(Math.round((progress.positionSecs / progress.durationSecs) * 100), 99)
    : null

  return (
    <article
      ref={cardRef}
      className={`${styles.card} ${styles[size]} ${item.isPremium && !isSubscribed ? styles.premiumCard : ''}`}
      onClick={() => onClick?.(item)}
      role="button"
      tabIndex={0}
      aria-label={`${cleanTitle}, ${item.type}`}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(item)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Poster image */}
      <div
        className={styles.poster}
        style={posterSrc ? undefined : { background: item.palette || 'rgba(255,255,255,0.04)' }}
      >
        {posterSrc && (
          <img
            src={posterSrc}
            alt={cleanTitle}
            className={styles.posterImg}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        )}
        {trailerSrc && (
          <video
            ref={onVideoRef}
            className={styles.trailerVideo}
            autoPlay muted playsInline loop
          />
        )}
        <div className={styles.gradient} />
        {progressPct !== null && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
        )}

        {/* Info area — strip fades in above title on hover */}
        <div className={styles.info}>
          <div className={styles.infoStrip}>
            {genres.map(g => (
              <span key={g} className={styles.genreChip}>{g}</span>
            ))}
            {item.releaseYear && (
              <span className={styles.metaChip}>{item.releaseYear}</span>
            )}
            {progress?.episodeNumber != null
              ? <span className={styles.metaChip}>Ep {progress.episodeNumber}</span>
              : episodeInfo && <span className={styles.metaChip}>{episodeInfo}</span>
            }
          </div>

          <div className={styles.meta}>
            <span className={styles.type}>{item.type}</span>
            <span className={styles.title}>{cleanTitle}</span>
          </div>
        </div>
      </div>

      {/* PRO badge */}
      {item.isPremium && (
        <div className={styles.proBadge}>
          <Crown size={10} color="#fff" />
          <span>PRO</span>
        </div>
      )}

      {/* NEW / LIVE badge */}
      {item.badge && (
        <div className={`${styles.cornerBadge} ${item.badge === 'LIVE' ? styles.liveBadge : styles.newBadge}`}>
          {item.badge === 'LIVE' && <span className={styles.liveDot} />}
          {item.badge}
        </div>
      )}

      {/* Rating — only when no other top-left badge */}
      {!item.badge && !item.isPremium && item.rating > 0 && (
        <div className={styles.ratingBadge}>
          <Star size={10} color="#db2777" fill="#db2777" />
          <span>{item.rating}</span>
        </div>
      )}
    </article>
  )
}

export default memo(PosterCard)

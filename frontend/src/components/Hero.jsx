import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Info, Volume2, VolumeX, Star, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { fetchFeaturedContent } from '../services/api'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './Hero.module.css'

const SLIDE_DURATION = 6000

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

function formatReviewCount(n) {
  if (!n || n === 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

function getHeroImage(item) {
  const src = item.backdropUrl || item.posterUrl || null
  return src
    ? cloudinaryTransform(src, 'w_1400,h_800,c_fill,g_auto,f_auto,q_auto')
    : null
}

export default function Hero() {
  const { muted, toggleMuted, openItem, isLoggedIn, openAuth } = useStore()
  const navigate   = useNavigate()
  const [items,     setItems]     = useState([])
  const [active,    setActive]    = useState(0)
  const [paused,    setPaused]    = useState(false)
  const timerRef     = useRef(null)
  const touchStartX  = useRef(null)
  const touchStartY  = useRef(null)

  useEffect(() => {
    fetchFeaturedContent().then(setItems).catch(() => {})
  }, [])

  const goTo = useCallback((idx) => {
    setActive(idx)
  }, [])

  const prev = useCallback(() => {
    setActive(i => (i - 1 + items.length) % items.length)
    setPaused(true)
  }, [items.length])

  const next = useCallback(() => {
    setActive(i => (i + 1) % items.length)
    setPaused(true)
  }, [items.length])

  // Auto-advance
  useEffect(() => {
    if (items.length <= 1 || paused) return
    timerRef.current = setInterval(() => {
      setActive(i => (i + 1) % items.length)
    }, SLIDE_DURATION)
    return () => clearInterval(timerRef.current)
  }, [items.length, paused])

  // Resume auto-advance 10s after manual interaction
  useEffect(() => {
    if (!paused) return
    const resume = setTimeout(() => setPaused(false), 10_000)
    return () => clearTimeout(resume)
  }, [paused])

  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (touchStartX.current === null || items.length <= 1) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? next() : prev()
    }
    touchStartX.current = null
    touchStartY.current = null
  }, [items.length, next, prev])

  const handleTouchCancel = useCallback(() => {
    touchStartX.current = null
    touchStartY.current = null
  }, [])

  if (items.length === 0) return <div className={styles.hero} aria-hidden="true" />

  const featured    = items[active]
  const cleanTitle  = stripExtension(featured.title)
  const genreStr    = Array.isArray(featured.genre) ? featured.genre.join(' · ') : (featured.genre ?? '')
  const episodeStr  = featured.episodes?.length ? `${featured.episodes.length} Episodes` : featured.type
  const rating      = featured.rating ?? 0
  const reviewCount = formatReviewCount(featured.reviewCount)
  const fullStars   = Math.floor(rating)
  const halfStar    = rating - fullStars >= 0.5
  const multi       = items.length > 1

  return (
    <section
      className={styles.hero}
      aria-label="Featured content"
      onMouseEnter={() => multi && setPaused(true)}
      onMouseLeave={() => multi && setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Background slides — crossfade between them */}
      {items.map((item, i) => {
        const img = getHeroImage(item)
        return (
          <div
            key={item.id || item._id}
            className={`${styles.slide} ${i === active ? styles.slideActive : ''}`}
            style={img
              ? { backgroundImage: `url(${img})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: item.palette || '#09090b' }
            }
            aria-hidden={i !== active}
          />
        )
      })}

      {/* Overlays */}
      <div className={styles.radialOverlay} />
      <div className={styles.sideOverlay} />
      <div className={styles.bottomFade} />
      <div className={styles.breathOverlay} aria-hidden="true" />
      <div className={styles.ring1} aria-hidden="true" />
      <div className={styles.ring2} aria-hidden="true" />
      <div className={styles.dot}   aria-hidden="true" />

      {/* Content — keyed by active so it fades in on each slide */}
      <div key={active} className={styles.content}>
        <div className={styles.eyebrow}>
          <div className={styles.eyebrowBar} />
          <span>Featured Original</span>
        </div>

        <h1 className={styles.heading}>{cleanTitle}</h1>

        {(genreStr || episodeStr) && (
          <p className={styles.genre}>
            {[genreStr, episodeStr].filter(Boolean).join(' · ')}
          </p>
        )}

        {rating > 0 && (
          <div className={styles.rating}>
            {Array.from({ length: 5 }, (_, i) => {
              const filled = i < fullStars
              const half   = !filled && halfStar && i === fullStars
              return (
                <Star
                  key={i}
                  size={14}
                  color="#db2777"
                  fill={filled ? '#db2777' : half ? 'rgba(219,39,119,0.5)' : 'rgba(219,39,119,0.15)'}
                />
              )
            })}
            <span className={styles.ratingText}>
              {rating.toFixed(1)}
              {reviewCount && <> · {reviewCount} reviews</>}
            </span>
          </div>
        )}

        {featured.desc && <p className={styles.desc}>{featured.desc}</p>}

        <div className={styles.actions}>
          <button
            className={styles.watchBtn}
            onClick={() => isLoggedIn
              ? navigate(`/watch/${featured._id || featured.id}`)
              : openAuth('signin', `/watch/${featured._id || featured.id}`)}
          >
            <Play size={18} color="#000" fill="#000" />
            Watch Now
          </button>

          <button className={styles.infoBtn} onClick={() => openItem(featured)}>
            <Info size={16} />
            More Info
          </button>

          <button className={styles.muteBtn} onClick={toggleMuted} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* Prev / Next arrows — only when multiple items */}
      {multi && (
        <>
          <button className={`${styles.navBtn} ${styles.navPrev}`} onClick={prev} aria-label="Previous">
            <ChevronLeft size={22} />
          </button>
          <button className={`${styles.navBtn} ${styles.navNext}`} onClick={next} aria-label="Next">
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* Dot indicators + progress bar — only when multiple items */}
      {multi && (
        <div className={styles.indicators}>
          {items.map((_, i) => (
            <button
              key={i}
              className={`${styles.indicatorDot} ${i === active ? styles.indicatorDotActive : ''}`}
              onClick={() => { goTo(i); setPaused(true) }}
              aria-label={`Go to slide ${i + 1}`}
            >
              {i === active && !paused && (
                <span
                  className={styles.indicatorProgress}
                  style={{ animationDuration: `${SLIDE_DURATION}ms` }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

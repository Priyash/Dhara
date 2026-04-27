import { useState, useEffect } from 'react'
import { Play, Info, Volume2, VolumeX, Star } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { fetchFeaturedContent } from '../services/api'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './Hero.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

function formatReviewCount(n) {
  if (!n || n === 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export default function Hero() {
  const { muted, toggleMuted, openItem } = useStore()
  const navigate = useNavigate()
  const [featured, setFeatured] = useState(null)

  useEffect(() => {
    fetchFeaturedContent().then(setFeatured).catch(() => {})
  }, [])

  if (!featured) return <div className={styles.hero} aria-hidden="true" />

  const cleanTitle   = stripExtension(featured.title)

  const heroImageUrl = featured.backdropUrl
    ? cloudinaryTransform(featured.backdropUrl, 'w_1400,h_800,c_fill,g_auto,f_auto,q_auto')
    : featured.posterUrl
    ? cloudinaryTransform(featured.posterUrl,   'w_1400,h_800,c_fill,g_auto,f_auto,q_auto')
    : null

  const genreStr     = Array.isArray(featured.genre) ? featured.genre.join(' · ') : (featured.genre ?? '')
  const episodeStr   = featured.episodes?.length ? `${featured.episodes.length} Episodes` : featured.type
  const rating       = featured.rating ?? 0
  const reviewCount  = formatReviewCount(featured.reviewCount)
  const fullStars    = Math.floor(rating)
  const halfStar     = rating - fullStars >= 0.5

  const handleWatch = () => navigate(`/watch/${featured.id}`)

  const heroStyle = heroImageUrl
    ? { backgroundImage: `url(${heroImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: featured.palette }

  return (
    <section className={styles.hero} style={heroStyle} aria-label="Featured content">
      <div className={styles.radialOverlay} />
      <div className={styles.sideOverlay} />
      <div className={styles.bottomFade} />
      <div className={styles.ring1} aria-hidden="true" />
      <div className={styles.ring2} aria-hidden="true" />
      <div className={styles.dot} aria-hidden="true" />

      <div className={styles.content}>
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
                  color="#f59e0b"
                  fill={filled ? '#f59e0b' : half ? 'rgba(245,158,11,0.5)' : 'rgba(245,158,11,0.15)'}
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
          <button className={styles.watchBtn} onClick={handleWatch}>
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
    </section>
  )
}

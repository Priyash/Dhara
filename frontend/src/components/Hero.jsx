import { useState, useEffect } from 'react'
import { Play, Info, Volume2, VolumeX, Star } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fetchFeaturedContent } from '../services/api'
import styles from './Hero.module.css'

export default function Hero() {
  const { muted, toggleMuted, openItem } = useStore()
  const [featured, setFeatured] = useState(null)

  useEffect(() => {
    fetchFeaturedContent().then(setFeatured).catch(() => {})
  }, [])

  if (!featured) return <div className={styles.hero} aria-hidden="true" />

  const genreStr    = Array.isArray(featured.genre) ? featured.genre.join(' · ') : (featured.genre ?? '')
  const episodeStr  = featured.episodes?.length
    ? `${featured.episodes.length} Episodes`
    : featured.type

  return (
    <section className={styles.hero} style={{ background: featured.palette }} aria-label="Featured content">
      {/* Overlays */}
      <div className={styles.radialOverlay} />
      <div className={styles.sideOverlay} />
      <div className={styles.bottomFade} />

      {/* Decorative rings */}
      <div className={styles.ring1} aria-hidden="true" />
      <div className={styles.ring2} aria-hidden="true" />
      <div className={styles.dot} aria-hidden="true" />

      {/* Content */}
      <div className={styles.content}>
        <div className={styles.eyebrow}>
          <div className={styles.eyebrowBar} />
          <span>Featured Original</span>
        </div>

        <h1 className={styles.heading}>{featured.title}</h1>

        <p className={styles.genre}>
          {genreStr} · {episodeStr}
        </p>

        <div className={styles.rating}>
          {[1, 2, 3, 4].map((i) => (
            <Star key={i} size={14} color="#f59e0b" fill="#f59e0b" />
          ))}
          <Star size={14} color="#f59e0b" fill="rgba(245,158,11,0.3)" />
          <span className={styles.ratingText}>{featured.rating} · 12.4k reviews</span>
        </div>

        <p className={styles.desc}>{featured.desc}</p>

        <div className={styles.actions}>
          <button className={styles.watchBtn}>
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

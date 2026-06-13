import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import PosterCard from './PosterCard'
import styles from './CuratedShelfRow.module.css'

export default function CuratedShelfRow({ shelf, onCardClick, isSubscribed = false }) {
  const rowRef   = useRef(null)
  const navigate = useNavigate()

  const scroll = (dir) => {
    rowRef.current?.scrollBy({ left: dir * 600, behavior: 'smooth' })
  }

  if (!shelf.items?.length) return null

  const accent = shelf.accentColor || '#db2777'

  return (
    <section
      className={styles.shelf}
      style={{ '--shelf-accent': accent }}
      aria-label={shelf.name}
    >
      {/* ── Cinematic banner ── */}
      <div
        className={styles.banner}
        style={{
          backgroundImage: shelf.backdropUrl ? `url(${shelf.backdropUrl})` : undefined,
          background: shelf.backdropUrl ? undefined : `linear-gradient(135deg, ${accent}18 0%, ${accent}06 60%, transparent 100%)`,
        }}
      >
        <div className={styles.bannerOverlay} />
        <div className={styles.bannerContent}>
          <span className={styles.bannerEyebrow}>Curated Collection</span>
          <h3 className={styles.bannerName} style={{ color: accent }}>{shelf.name}</h3>
          {shelf.tagline && <p className={styles.bannerTagline}>{shelf.tagline}</p>}
        </div>
        <button
          className={styles.bannerSeeAll}
          style={{ color: accent, borderColor: accent + '44' }}
          onClick={() => navigate('/browse')}
        >
          See all <ChevronRight size={13} />
        </button>
        {/* Accent underline */}
        <div className={styles.bannerAccentLine} style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      </div>

      {/* ── Scroll row ── */}
      <div className={styles.rowWrapper}>
        <button
          className={`${styles.scrollBtn} ${styles.scrollLeft}`}
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
        >
          <ChevronLeft size={18} />
        </button>

        <div ref={rowRef} className={styles.row}>
          {shelf.items.map((item) => (
            <PosterCard
              key={item._id || item.id}
              item={item}
              onClick={onCardClick}
              isSubscribed={isSubscribed}
              source={`shelf:${shelf.name}`}
            />
          ))}
        </div>

        <button
          className={`${styles.scrollBtn} ${styles.scrollRight}`}
          onClick={() => scroll(1)}
          aria-label="Scroll right"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  )
}

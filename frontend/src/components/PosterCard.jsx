import { useState } from 'react'
import { Play, Crown, Star } from 'lucide-react'
import styles from './PosterCard.module.css'

export default function PosterCard({ item, onClick, size = 'normal' }) {
  const [hovered, setHovered] = useState(false)

  return (
    <article
      className={`${styles.card} ${styles[size]} ${hovered ? styles.hovered : ''}`}
      onClick={() => onClick?.(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={`${item.title}, ${item.type}`}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(item)}
    >
      {/* Poster art */}
      <div className={styles.poster} style={{ background: item.palette }}>
        <div className={styles.gradient} />

        {/* Meta below */}
        <div className={styles.meta}>
          <span className={styles.type}>{item.type}</span>
          <span className={styles.title}>{item.title}</span>
        </div>
      </div>

      {/* PRO badge */}
      {item.isPremium && (
        <div className={styles.proBadge}>
          <Crown size={10} color="#fff" />
          <span>PRO</span>
        </div>
      )}

      {/* NEW badge */}
      {item.badge && (
        <div className={styles.newBadge}>{item.badge}</div>
      )}

      {/* Rating (shown when no other top-left badge) */}
      {!item.badge && !item.isPremium && (
        <div className={styles.ratingBadge}>
          <Star size={10} color="#f59e0b" fill="#f59e0b" />
          <span>{item.rating}</span>
        </div>
      )}

      {/* Play overlay */}
      {hovered && (
        <div className={styles.overlay} aria-hidden="true">
          <div className={styles.playBtn}>
            <Play size={18} color="#09090b" fill="#09090b" style={{ marginLeft: 2 }} />
          </div>
        </div>
      )}
    </article>
  )
}

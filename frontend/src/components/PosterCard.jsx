import { useState } from 'react'
import { Play, Crown, Star } from 'lucide-react'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './PosterCard.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function PosterCard({ item, onClick, size = 'normal' }) {
  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const posterSrc = item.posterUrl && !imgError
    ? cloudinaryTransform(item.posterUrl, 'w_400,h_600,c_fill,g_auto,f_auto,q_auto')
    : null

  const cleanTitle = stripExtension(item.title)

  return (
    <article
      className={`${styles.card} ${styles[size]} ${hovered ? styles.hovered : ''}`}
      onClick={() => onClick?.(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={`${cleanTitle}, ${item.type}`}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(item)}
    >
      {/* Poster art */}
      <div
        className={styles.poster}
        style={posterSrc ? undefined : { background: item.palette }}
      >
        {posterSrc && (
          <img
            src={posterSrc}
            alt={cleanTitle}
            className={styles.posterImg}
            onError={() => setImgError(true)}
          />
        )}
        <div className={styles.gradient} />

        {/* Meta below */}
        <div className={styles.meta}>
          <span className={styles.type}>{item.type}</span>
          <span className={styles.title}>{cleanTitle}</span>
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

import { useState } from 'react'
import { Crown, Star } from 'lucide-react'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './PosterCard.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function PosterCard({ item, onClick, size = 'normal', isSubscribed = false }) {
  const [imgError, setImgError] = useState(false)

  const posterSrc = item.posterUrl && !imgError
    ? cloudinaryTransform(item.posterUrl, 'w_400,h_600,c_fill,g_auto,f_auto,q_auto')
    : null

  const cleanTitle  = stripExtension(item.title)
  const genres      = (item.genre || []).slice(0, 2)
  const episodeInfo = item.type === 'Series' && item.episodes?.length
    ? `${item.episodes.length} Ep`
    : null

  return (
    <article
      className={`${styles.card} ${styles[size]} ${item.isPremium && !isSubscribed ? styles.premiumCard : ''}`}
      onClick={() => onClick?.(item)}
      role="button"
      tabIndex={0}
      aria-label={`${cleanTitle}, ${item.type}`}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(item)}
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
            onError={() => setImgError(true)}
          />
        )}
        <div className={styles.gradient} />

        {/* Info area — strip fades in above title on hover */}
        <div className={styles.info}>
          <div className={styles.infoStrip}>
            {genres.map(g => (
              <span key={g} className={styles.genreChip}>{g}</span>
            ))}
            {item.releaseYear && (
              <span className={styles.metaChip}>{item.releaseYear}</span>
            )}
            {episodeInfo && (
              <span className={styles.metaChip}>{episodeInfo}</span>
            )}
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
          <Star size={10} color="#f59e0b" fill="#f59e0b" />
          <span>{item.rating}</span>
        </div>
      )}
    </article>
  )
}

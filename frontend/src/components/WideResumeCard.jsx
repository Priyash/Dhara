import { Play } from 'lucide-react'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './WideResumeCard.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function WideResumeCard({ items, onCardClick }) {
  if (!items?.length) return null

  const primary = items[0]
  const rest    = items.slice(1)
  const pct     = primary.progressPct ?? primary.progress ?? 0
  const src     = primary.backdropUrl || primary.posterUrl
  const imgUrl  = src
    ? cloudinaryTransform(src, 'w_900,h_506,c_fill,g_auto,f_auto,q_auto')
    : null
  const title   = stripExtension(primary.title || '')
  const genre   = Array.isArray(primary.genre)
    ? primary.genre.slice(0, 2).join(' · ')
    : (primary.genre ?? '')

  const handleResume = () => onCardClick?.(primary)

  return (
    <section className={styles.wrap} aria-label="Continue Watching">
      <p className={styles.eyebrow}>Continue Watching</p>

      <div className={styles.card} onClick={handleResume}>
        <div className={styles.backdrop}>
          {imgUrl
            ? <img src={imgUrl} alt={title} className={styles.backdropImg} />
            : <div className={styles.backdropFallback} />
          }
          <div className={styles.backdropFade} />
        </div>

        <div className={styles.info}>
          {genre && <span className={styles.genre}>{genre}</span>}
          <h3 className={styles.title}>{title}</h3>

          {pct > 0 && (
            <div className={styles.progressWrap}>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <span className={styles.progressLabel}>{Math.round(pct)}% watched</span>
            </div>
          )}

          <button
            className={styles.resumeBtn}
            onClick={(e) => { e.stopPropagation(); handleResume() }}
          >
            <Play size={15} fill="currentColor" /> Resume
          </button>
        </div>

        {rest.length > 0 && (
          <div className={styles.moreBadge}>+{rest.length} more</div>
        )}
      </div>
    </section>
  )
}

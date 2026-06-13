import { Play } from 'lucide-react'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './WideResumeCard.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function WideResumeCard({ items, onCardClick }) {
  if (!items?.length) return null

  // Single item — keep the wide cinematic card
  if (items.length === 1) {
    return <SingleCard item={items[0]} onCardClick={onCardClick} />
  }

  // Multiple items — horizontal scroll rail
  return (
    <section className={styles.wrap} aria-label="Continue Watching">
      <p className={styles.eyebrow}>Continue Watching</p>
      <div className={styles.rail}>
        {items.map((item) => (
          <ResumeThumb key={item.id || item._id} item={item} onCardClick={onCardClick} />
        ))}
      </div>
    </section>
  )
}

function SingleCard({ item, onCardClick }) {
  const pct    = item.progressPct ?? item.progress ?? 0
  const src    = item.backdropUrl || item.posterUrl
  const imgUrl = src
    ? cloudinaryTransform(src, 'w_900,h_506,c_fill,g_auto,f_auto,q_auto')
    : null
  const title  = stripExtension(item.title || '')
  const genre  = Array.isArray(item.genre)
    ? item.genre.slice(0, 2).join(' · ')
    : (item.genre ?? '')

  return (
    <section className={styles.wrap} aria-label="Continue Watching">
      <p className={styles.eyebrow}>Continue Watching</p>
      <div className={styles.card} onClick={() => onCardClick?.(item)}>
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
            onClick={(e) => { e.stopPropagation(); onCardClick?.(item) }}
          >
            <Play size={15} fill="currentColor" /> Resume
          </button>
        </div>
      </div>
    </section>
  )
}

function ResumeThumb({ item, onCardClick }) {
  const pct    = item.progressPct ?? item.progress ?? 0
  const src    = item.backdropUrl || item.posterUrl
  const imgUrl = src
    ? cloudinaryTransform(src, 'w_480,h_270,c_fill,g_auto,f_auto,q_auto')
    : null
  const title  = stripExtension(item.title || '')

  return (
    <div className={styles.thumb} onClick={() => onCardClick?.(item)} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onCardClick?.(item)}>
      <div className={styles.thumbImg}>
        {imgUrl
          ? <img src={imgUrl} alt={title} className={styles.thumbPoster} />
          : <div className={styles.thumbFallback} />
        }
        <div className={styles.thumbScrim} />
        <button
          className={styles.thumbPlay}
          onClick={(e) => { e.stopPropagation(); onCardClick?.(item) }}
          aria-label={`Resume ${title}`}
        >
          <Play size={16} fill="currentColor" />
        </button>
        {pct > 0 && (
          <div className={styles.thumbBar}>
            <div className={styles.thumbFill} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        )}
      </div>
      <p className={styles.thumbTitle}>{title}</p>
      {pct > 0 && <p className={styles.thumbPct}>{Math.round(pct)}% watched</p>}
    </div>
  )
}

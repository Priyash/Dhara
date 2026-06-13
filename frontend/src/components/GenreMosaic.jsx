import { Play } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './GenreMosaic.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

function Tile({ item, large, onCardClick }) {
  const src    = item.backdropUrl || item.posterUrl
  const imgUrl = src
    ? cloudinaryTransform(src, large ? 'w_720,h_520,c_fill,g_auto,f_auto,q_auto' : 'w_360,h_260,c_fill,g_auto,f_auto,q_auto')
    : null
  const label  = stripExtension(item.title || '')

  return (
    <button
      className={`${styles.tile} ${large ? styles.tileLarge : styles.tileSmall}`}
      onClick={() => onCardClick?.(item)}
      aria-label={label}
    >
      {imgUrl
        ? <img src={imgUrl} alt={label} className={styles.tileImg} />
        : <div className={styles.tileFallback} />
      }
      <div className={styles.tileOverlay} />
      <span className={styles.tileTitle}>{label}</span>
      <div className={styles.tilePlay}>
        <Play size={large ? 20 : 15} fill="currentColor" />
      </div>
    </button>
  )
}

export default function GenreMosaic({ title, eyebrow, items, onCardClick, onSeeAll }) {
  if (!items || items.length < 5) return null

  const [large, ...smalls] = items.slice(0, 5)

  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.header}>
        <div>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 className={styles.title}>{title}</h2>
        </div>
        {onSeeAll && (
          <button className={styles.seeAll} onClick={onSeeAll}>
            See all <ChevronRight size={14} />
          </button>
        )}
      </div>

      <div className={styles.grid}>
        <Tile item={large} large onCardClick={onCardClick} />
        <div className={styles.smallGrid}>
          {smalls.map((item) => (
            <Tile key={item._id || item.id} item={item} onCardClick={onCardClick} />
          ))}
        </div>
      </div>
    </section>
  )
}

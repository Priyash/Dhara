import { useRef } from 'react'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './CinematicRow.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function CinematicRow({ title, eyebrow, items, onCardClick, onSeeAll }) {
  const rowRef = useRef(null)

  const scroll = (dir) => {
    if (!rowRef.current) return
    rowRef.current.scrollBy({ left: dir * 700, behavior: 'smooth' })
  }

  if (!items?.length) return null

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

      <div className={styles.wrapper}>
        <button
          className={`${styles.scrollBtn} ${styles.scrollLeft}`}
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
        >
          <ChevronLeft size={20} />
        </button>

        <div ref={rowRef} className={styles.row}>
          {items.map((item) => {
            const src    = item.backdropUrl || item.posterUrl
            const imgUrl = src
              ? cloudinaryTransform(src, 'w_640,h_360,c_fill,g_auto,f_auto,q_auto')
              : null
            const label  = stripExtension(item.title || '')
            const genre  = Array.isArray(item.genre) ? item.genre[0] : item.genre

            return (
              <button
                key={item._id || item.id}
                className={styles.card}
                onClick={() => onCardClick?.(item)}
                aria-label={label}
              >
                {imgUrl
                  ? <img src={imgUrl} alt={label} className={styles.img} />
                  : <div className={styles.imgFallback} />
                }
                <div className={styles.overlay} />
                <div className={styles.cardInfo}>
                  {genre && <span className={styles.cardGenre}>{genre}</span>}
                  <span className={styles.cardTitle}>{label}</span>
                </div>
                <div className={styles.playBtn}>
                  <Play size={18} fill="currentColor" />
                </div>
                {item.badge && (
                  <span className={styles.badge}>{item.badge}</span>
                )}
              </button>
            )
          })}
        </div>

        <button
          className={`${styles.scrollBtn} ${styles.scrollRight}`}
          onClick={() => scroll(1)}
          aria-label="Scroll right"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </section>
  )
}

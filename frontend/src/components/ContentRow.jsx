import { useRef } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import PosterCard from './PosterCard'
import styles from './ContentRow.module.css'

export default function ContentRow({ title, eyebrow, items, onCardClick, isSubscribed = false, onSeeAll, eventSource, ranked = false }) {
  const rowRef = useRef(null)

  const scroll = (dir) => {
    if (!rowRef.current) return
    rowRef.current.scrollBy({ left: dir * 600, behavior: 'smooth' })
  }

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

        <div ref={rowRef} className={`${styles.row} ${ranked ? styles.rankedRow : ''}`}>
          {items.map((item) => (
            ranked && item._rank != null ? (
              <div key={item.id} className={styles.rankedItem}>
                <span className={styles.rankNum}>{item._rank}</span>
                <PosterCard
                  item={item}
                  onClick={onCardClick}
                  isSubscribed={isSubscribed}
                  source={eventSource || title}
                />
              </div>
            ) : (
              <PosterCard
                key={item.id}
                item={item}
                onClick={onCardClick}
                isSubscribed={isSubscribed}
                source={eventSource || title}
              />
            )
          ))}
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

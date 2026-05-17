import { useRef } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import PosterCard from './PosterCard'
import styles from './ContentRow.module.css'

export default function ContentRow({ title, items, onCardClick, isSubscribed = false, onSeeAll, eventSource }) {
  const rowRef = useRef(null)

  const scroll = (dir) => {
    if (!rowRef.current) return
    rowRef.current.scrollBy({ left: dir * 600, behavior: 'smooth' })
  }

  return (
    <section className={styles.section} aria-label={title}>
      {/* Row header */}
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {onSeeAll && (
          <button className={styles.seeAll} onClick={onSeeAll}>
            See all <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Scrollable row */}
      <div className={styles.wrapper}>
        <button
          className={`${styles.scrollBtn} ${styles.scrollLeft}`}
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
        >
          <ChevronLeft size={20} />
        </button>

        <div ref={rowRef} className={styles.row}>
          {items.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              onClick={onCardClick}
              isSubscribed={isSubscribed}
              source={eventSource || title}
            />
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

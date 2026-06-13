import { ChevronRight } from 'lucide-react'
import PosterCard from './PosterCard'
import styles from './CategoryGrid.module.css'

const GRID_LIMIT = 10 // 2 rows × 5 cols on desktop

export default function CategoryGrid({
  title,
  eyebrow,
  items,
  onCardClick,
  isSubscribed = false,
  onSeeAll,
  totalCount,
  eventSource,
}) {
  if (!items?.length) return null

  const visible = items.slice(0, GRID_LIMIT)
  const count   = totalCount ?? items.length

  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.header}>
        <div>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 className={styles.title}>{title}</h2>
        </div>
        {onSeeAll && (
          <button className={styles.seeAll} onClick={onSeeAll}>
            Browse all {count > GRID_LIMIT ? `${count} ` : ''}{title}
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      <div className={styles.grid}>
        {visible.map((item) => (
          <PosterCard
            key={item._id || item.id}
            item={item}
            onClick={onCardClick}
            isSubscribed={isSubscribed}
            source={eventSource || title}
          />
        ))}

        {/* "See all" tile at the end when there are more items */}
        {onSeeAll && items.length > GRID_LIMIT && (
          <button className={styles.moreTile} onClick={onSeeAll} aria-label={`Browse all ${title}`}>
            <span className={styles.moreCount}>+{items.length - GRID_LIMIT}</span>
            <span className={styles.moreLabel}>See all</span>
            <ChevronRight size={18} className={styles.moreArrow} />
          </button>
        )}
      </div>
    </section>
  )
}

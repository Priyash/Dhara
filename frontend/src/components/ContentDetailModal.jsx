import { X, Play, Plus, Star, Crown } from 'lucide-react'
import { useStore } from '../store/useStore'
import styles from './ContentDetailModal.module.css'

export default function ContentDetailModal() {
  const { selectedItem: item, setSelectedItem, openPaywall } = useStore()
  if (!item) return null

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={item.title}>
      <div className={styles.modal}>
        {/* Poster header */}
        <div className={styles.header} style={{ background: item.palette }}>
          <div className={styles.headerFade} />

          <button
            className={styles.closeBtn}
            onClick={() => setSelectedItem(null)}
            aria-label="Close"
          >
            <X size={16} />
          </button>

          <div className={styles.headerContent}>
            {item.isPremium && (
              <div className={styles.proBadge}>
                <Crown size={11} color="#fff" />
                <span>PRO Exclusive</span>
              </div>
            )}
            <h2 className={styles.title}>{item.title}</h2>
            <div className={styles.meta}>
              <Star size={12} color="#f59e0b" fill="#f59e0b" />
              <span>
            {item.rating} · {item.type}
            {Array.isArray(item.episodes) && item.episodes.length > 0
              ? ` · ${item.episodes.length} Episodes`
              : typeof item.episodes === 'string' && item.episodes
              ? ` · ${item.episodes}`
              : ''}
          </span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          <p className={styles.desc}>
            {item.desc ||
              'A critically acclaimed production bringing authentic Bengali storytelling to life with stunning performances and an unforgettable narrative.'}
          </p>

          <div className={styles.actions}>
            {item.isPremium ? (
              <button className={styles.subscribeBtn} onClick={openPaywall}>
                <Crown size={16} color="#000" />
                Subscribe to Watch
              </button>
            ) : (
              <button className={styles.watchBtn}>
                <Play size={16} color="#000" fill="#000" />
                Watch Now
              </button>
            )}

            <button className={styles.addBtn} aria-label="Add to watchlist">
              <Plus size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

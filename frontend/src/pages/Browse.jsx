import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filter } from 'lucide-react'
import PosterCard from '../components/PosterCard'
import { fetchContent } from '../services/api'
import { useStore } from '../store/useStore'
import styles from './Browse.module.css'

const TYPES   = ['All', 'Film', 'Series']
const FILTERS = ['All', 'Free', 'Premium', 'New']

export default function Browse() {
  const navigate     = useNavigate()
  const { isSubscribed, openItem, openPaywall, isLoggedIn } = useStore()
  const [content,      setContent]      = useState([])
  const [activeType,   setActiveType]   = useState('All')
  const [activeFilter, setActiveFilter] = useState('All')
  const [sortBy,       setSortBy]       = useState('rating')

  useEffect(() => {
    fetchContent().then(setContent).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    let list = [...content]

    if (activeType !== 'All')
      list = list.filter((c) => c.type === activeType)

    if (activeFilter === 'Free')    list = list.filter((c) => !c.isPremium)
    if (activeFilter === 'Premium') list = list.filter((c) =>  c.isPremium)
    if (activeFilter === 'New')     list = list.filter((c) =>  c.badge === 'NEW')

    if (sortBy === 'rating') list.sort((a, b) => b.rating - a.rating)
    if (sortBy === 'title')  list.sort((a, b) => a.title.localeCompare(b.title))

    return list
  }, [content, activeType, activeFilter, sortBy])

  return (
    <main className={styles.page}>
      {/* Page header */}
      <div className={styles.header}>
        <h1 className={styles.heading}>Browse</h1>
        <p className={styles.sub}>{filtered.length} titles</p>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        {/* Type tabs */}
        <div className={styles.tabs} role="tablist">
          {TYPES.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={activeType === t}
              className={`${styles.tab} ${activeType === t ? styles.tabActive : ''}`}
              onClick={() => setActiveType(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className={styles.toolbarRight}>
          {/* Filter pills */}
          <div className={styles.pills}>
            {FILTERS.map((f) => (
              <button
                key={f}
                className={`${styles.pill} ${activeFilter === f ? styles.pillActive : ''}`}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className={styles.sortGroup}>
            <Filter size={14} color="rgba(255,255,255,0.5)" />
            <select
              className={styles.sort}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort by"
            >
              <option value="rating">Top Rated</option>
              <option value="title">A – Z</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className={styles.empty}>No titles match the current filters.</p>
      ) : (
        <div className={styles.grid}>
          {filtered.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              size="large"
              isSubscribed={isSubscribed}
              onClick={(clickedItem) => {
                if (clickedItem.isPremium && !isSubscribed) {
                  openItem(clickedItem)   // show detail modal → "Subscribe to Watch" CTA
                } else {
                  navigate(`/watch/${clickedItem.id}`)
                }
              }}
            />
          ))}
        </div>
      )}
    </main>
  )
}

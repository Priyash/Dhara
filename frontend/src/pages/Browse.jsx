import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Film, Tv2, BookOpen, Radio, LayoutGrid, ChevronDown, Check, Tag } from 'lucide-react'
import PosterCard from '../components/PosterCard'
import { fetchContent } from '../services/api'
import { useStore } from '../store/useStore'
import styles from './Browse.module.css'

const FILTERS = ['All', 'Free', 'Premium', 'New']

const SECTION_META = {
  Film:        { label: 'Movies',     eyebrow: 'Bengali Cinema',   Icon: Film,       accent: '#f59e0b' },
  Series:      { label: 'Series',     eyebrow: 'Bengali Series',   Icon: Tv2,        accent: '#818cf8' },
  Documentary: { label: 'Originals',  eyebrow: 'Dhara Originals',  Icon: BookOpen,   accent: '#34d399' },
  Live:        { label: 'Live',       eyebrow: 'Live Channels',    Icon: Radio,      accent: '#f87171' },
  All:         { label: 'Browse All', eyebrow: 'Dhara Streaming',  Icon: LayoutGrid, accent: '#f59e0b' },
}

const SECTION_GENRES = {
  Film:        ['Action', 'Adventure', 'Comedy', 'Crime', 'Drama', 'Family', 'Historical', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller'],
  Series:      ['Action', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Historical', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller'],
  Documentary: ['Art', 'Biography', 'Crime', 'Culture', 'History', 'Nature', 'Politics', 'Science', 'Society', 'Technology'],
  Live:        ['Culture', 'Events', 'Music', 'News', 'Sports', 'Talk Show'],
  All:         ['Action', 'Adventure', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Historical', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller'],
}

const VALID_TYPES = ['Film', 'Series', 'Documentary', 'Live']

export default function Browse() {
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const { isSubscribed, openItem } = useStore()
  const [content,      setContent]      = useState([])
  const [activeType,   setActiveType]   = useState('All')
  const [activeFilter, setActiveFilter] = useState('All')
  const [activeGenre,  setActiveGenre]  = useState('All')
  const [sortBy,       setSortBy]       = useState('rating')
  const [genreOpen,    setGenreOpen]    = useState(false)
  const genreDropdownRef = useRef(null)

  useEffect(() => {
    const t = searchParams.get('type')
    const f = searchParams.get('filter')
    setActiveType(VALID_TYPES.includes(t) ? t : 'All')
    setActiveFilter(FILTERS.includes(f) ? f : 'All')
    setActiveGenre('All')
    setGenreOpen(false)
  }, [searchParams])

  // Close dropdown on outside click
  useEffect(() => {
    if (!genreOpen) return
    const handler = (e) => {
      if (!genreDropdownRef.current?.contains(e.target)) setGenreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [genreOpen])

  useEffect(() => {
    fetchContent().then(setContent).catch(() => {})
  }, [])

  const typeFiltered = useMemo(() => {
    if (activeType === 'Live') return content.filter(c => c.badge === 'LIVE')
    if (activeType !== 'All')  return content.filter(c => c.type === activeType)
    return content
  }, [content, activeType])

  const genresWithCounts = useMemo(() => {
    const counts = {}
    for (const item of typeFiltered) {
      for (const g of (item.genre || [])) {
        if (g) counts[g] = (counts[g] || 0) + 1
      }
    }
    const predefined = SECTION_GENRES[activeType] || SECTION_GENRES.All
    const merged = [...new Set([...predefined, ...Object.keys(counts)])]
    return [
      { genre: 'All', count: typeFiltered.length },
      ...merged.sort().map(g => ({ genre: g, count: counts[g] || 0 })),
    ]
  }, [typeFiltered, activeType])

  const filtered = useMemo(() => {
    let list = [...typeFiltered]
    if (activeGenre !== 'All')    list = list.filter(c => c.genre?.includes(activeGenre))
    if (activeFilter === 'Free')    list = list.filter(c => !c.isPremium)
    if (activeFilter === 'Premium') list = list.filter(c =>  c.isPremium)
    if (activeFilter === 'New')     list = list.filter(c =>  c.badge === 'NEW')
    if (sortBy === 'rating') list.sort((a, b) => b.rating - a.rating)
    if (sortBy === 'newest') list.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0))
    if (sortBy === 'title')  list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [typeFiltered, activeGenre, activeFilter, sortBy])

  const { label, eyebrow, Icon, accent } = SECTION_META[activeType] || SECTION_META.All
  const hasActiveFilters = activeGenre !== 'All' || activeFilter !== 'All'
  const activeGenreCount = genresWithCounts.find(g => g.genre === activeGenre)?.count ?? 0

  return (
    <main className={styles.page}>

      {/* ── Hero header ── */}
      <div className={styles.hero} style={{ '--section-accent': accent }}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroLeft}>
            <div
              className={styles.heroIcon}
              style={{ background: `${accent}18`, border: `1px solid ${accent}28` }}
            >
              <Icon size={22} style={{ color: accent }} />
            </div>
            <div>
              <p className={styles.heroEyebrow}>{eyebrow}</p>
              <h1 className={styles.heroTitle} style={{ color: accent }}>{label}</h1>
              <div className={styles.heroMeta}>
                <span className={styles.heroCount}>
                  {filtered.length} title{filtered.length !== 1 ? 's' : ''}
                </span>
                {activeGenre !== 'All' && (
                  <span className={styles.heroBadge} style={{ background: `${accent}18`, color: accent }}>
                    {activeGenre}
                  </span>
                )}
                {activeFilter !== 'All' && (
                  <span className={styles.heroBadge} style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.55)' }}>
                    {activeFilter}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sticky filter bar ── */}
      <div className={styles.filterBar}>

        {/* Access filter + sort */}
        <div className={styles.controlRow}>
          <div className={styles.controlLeft}>

            {/* Genre dropdown */}
            <div className={styles.genreDropdown} ref={genreDropdownRef}>
              <button
                className={`${styles.genreTrigger} ${activeGenre !== 'All' ? styles.genreTriggerActive : ''}`}
                style={activeGenre !== 'All' ? { '--chip-accent': accent } : {}}
                onClick={() => setGenreOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={genreOpen}
              >
                <Tag size={12} style={{ opacity: 0.6 }} />
                <span className={styles.genreTriggerText}>
                  {activeGenre === 'All' ? 'Genre' : activeGenre}
                </span>
                {activeGenre !== 'All' && activeGenreCount > 0 && (
                  <span className={styles.genreTriggerCount}>{activeGenreCount}</span>
                )}
                <ChevronDown
                  size={13}
                  className={`${styles.chevron} ${genreOpen ? styles.chevronOpen : ''}`}
                />
              </button>

              {genreOpen && (
                <div className={styles.genrePanel} role="listbox">
                  <div className={styles.genrePanelScroll}>
                    {genresWithCounts.map(({ genre, count }) => {
                      const isActive = activeGenre === genre
                      return (
                        <button
                          key={genre}
                          role="option"
                          aria-selected={isActive}
                          className={`${styles.genreOption} ${isActive ? styles.genreOptionActive : ''}`}
                          style={isActive ? { '--chip-accent': accent } : {}}
                          onClick={() => { setActiveGenre(genre); setGenreOpen(false) }}
                        >
                          <span className={styles.genreOptionName}>{genre}</span>
                          <div className={styles.genreOptionRight}>
                            {count > 0 && (
                              <span className={`${styles.genreOptionCount} ${isActive ? styles.genreOptionCountActive : ''}`}>
                                {count}
                              </span>
                            )}
                            {isActive
                              ? <Check size={12} style={{ color: accent, flexShrink: 0 }} />
                              : <span style={{ width: 12, flexShrink: 0 }} />
                            }
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <span className={styles.controlDivider} />
            <span className={styles.accessLabel}>Show</span>
            {FILTERS.map(f => (
              <button
                key={f}
                className={`${styles.pill} ${activeFilter === f ? styles.pillActive : ''}`}
                style={activeFilter === f ? { '--chip-accent': accent } : {}}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          <div className={styles.controlRight}>
            <span className={styles.resultCount}>
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
            <div className={styles.sortGroup}>
              <ArrowUpDown size={11} color="rgba(255,255,255,0.35)" />
              <select
                className={styles.sort}
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                aria-label="Sort by"
              >
                <option value="rating">Top Rated</option>
                <option value="newest">Newest</option>
                <option value="title">A – Z</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content grid ── */}
      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <div
            className={styles.emptyIconWrap}
            style={{ background: `${accent}12`, border: `1px solid ${accent}20` }}
          >
            <Icon size={30} style={{ color: accent, opacity: 0.6 }} />
          </div>
          <p className={styles.emptyTitle}>No titles found</p>
          <p className={styles.emptySub}>
            {hasActiveFilters
              ? 'Try removing a genre or access filter to see more titles.'
              : 'No content is available in this section yet.'}
          </p>
          {hasActiveFilters && (
            <button
              className={styles.emptyClear}
              onClick={() => { setActiveGenre('All'); setActiveFilter('All') }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className={styles.gridWrap}>
          <div className={styles.grid}>
            {filtered.map(item => (
              <PosterCard
                key={item._id || item.id}
                item={item}
                size="large"
                isSubscribed={isSubscribed}
                onClick={clickedItem => {
                  if (clickedItem.isPremium && !isSubscribed) {
                    openItem(clickedItem)
                  } else {
                    navigate(`/watch/${clickedItem._id || clickedItem.id}`)
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

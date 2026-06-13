import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Film, Tv2, BookOpen, Radio, LayoutGrid, ChevronDown, Check, Tag, Loader2, X } from 'lucide-react'
import PosterCard from '../components/PosterCard'
import { fetchContent, fetchContentGenres } from '../services/api'
import { useStore } from '../store/useStore'
import styles from './Browse.module.css'

const PAGE_SIZE   = 24
const FILTERS     = ['All', 'Free', 'Premium', 'New']
const VALID_TYPES = ['Film', 'Series', 'Serial Drama', 'Documentary', 'Live']

const SECTION_META = {
  Film:           { label: 'Movies',        eyebrow: 'Bengali Cinema',        Icon: Film,       accent: '#db2777' },
  Series:         { label: 'Series',        eyebrow: 'Bengali Series',        Icon: Tv2,        accent: '#f472b6' },
  'Serial Drama': { label: 'ধারাবাহিক',     eyebrow: 'বাংলা ধারাবাহিক',       Icon: Tv2,        accent: '#f472b6' },
  Documentary:    { label: 'Originals',     eyebrow: 'Dhara Originals',       Icon: BookOpen,   accent: '#34d399' },
  Live:           { label: 'Live',          eyebrow: 'Live Channels',         Icon: Radio,      accent: '#f87171' },
  All:            { label: 'Browse All',    eyebrow: 'Dhara Streaming',       Icon: LayoutGrid, accent: '#db2777' },
}

export default function Browse() {
  const navigate        = useNavigate()
  const [searchParams]  = useSearchParams()
  const { isSubscribed, openItem } = useStore()

  // ── Filter state ─────────────────────────────────────────────────────────
  const [activeType,   setActiveType]   = useState('All')
  const [activeFilter, setActiveFilter] = useState('All')
  const [activeGenre,  setActiveGenre]  = useState('All')
  const [sortBy,       setSortBy]       = useState('rating')
  const [genreOpen,    setGenreOpen]    = useState(false)
  const genreDropdownRef = useRef(null)

  // ── Data state ───────────────────────────────────────────────────────────
  const [items,        setItems]        = useState([])
  const [total,        setTotal]        = useState(0)
  const [page,         setPage]         = useState(1)
  const [hasMore,      setHasMore]      = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [genreFacets,  setGenreFacets]  = useState([])

  // Sync URL params → filter state
  useEffect(() => {
    const t = searchParams.get('type')
    const f = searchParams.get('filter')
    setActiveType(VALID_TYPES.includes(t) ? t : 'All')
    setActiveFilter(FILTERS.includes(f) ? f : 'All')
    setActiveGenre('All')
    setGenreOpen(false)
  }, [searchParams])

  // Close genre dropdown on outside click
  useEffect(() => {
    if (!genreOpen) return
    const handler = (e) => {
      if (!genreDropdownRef.current?.contains(e.target)) setGenreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [genreOpen])

  // ── Fetch genre facets when type or access filter changes ─────────────────
  useEffect(() => {
    let cancelled = false
    const params = {}
    if (activeType   !== 'All') params.type   = activeType
    if (activeFilter !== 'All') params.filter = activeFilter

    fetchContentGenres(params)
      .then((facets) => { if (!cancelled) setGenreFacets(facets) })
      .catch(() => { if (!cancelled) setGenreFacets([]) })

    return () => { cancelled = true }
  }, [activeType, activeFilter])

  // ── Fetch content page 1 when any filter changes ─────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setItems([])
    setPage(1)

    const params = buildParams(activeType, activeFilter, activeGenre, sortBy, 1)
    fetchContent(params)
      .then((result) => {
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
        setHasMore(result.page < result.pages)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [activeType, activeFilter, activeGenre, sortBy])

  // ── Load more ─────────────────────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    const nextPage = page + 1
    setLoadingMore(true)

    const params = buildParams(activeType, activeFilter, activeGenre, sortBy, nextPage)
    fetchContent(params)
      .then((result) => {
        setItems((prev) => [...prev, ...result.items])
        setPage(nextPage)
        setHasMore(result.page < result.pages)
        setLoadingMore(false)
      })
      .catch(() => setLoadingMore(false))
  }, [page, hasMore, loadingMore, activeType, activeFilter, activeGenre, sortBy])

  const { label, eyebrow, Icon, accent } = SECTION_META[activeType] || SECTION_META.All
  const hasActiveFilters = activeGenre !== 'All' || activeFilter !== 'All'

  // Build the genre dropdown entries (server-provided facets + "All")
  const genreOptions = [
    { genre: 'All', count: total },
    ...genreFacets,
  ]

  return (
    <main className={styles.page}>

      {/* ── Hero header ── */}
      <div className={styles.hero} style={{ '--section-accent': accent }}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroLeft}>
            <div className={styles.heroIcon} style={{ background: `${accent}18`, border: `1px solid ${accent}28` }}>
              <Icon size={22} style={{ color: accent }} />
            </div>
            <div>
              <p className={styles.heroEyebrow}>{eyebrow}</p>
              <h1 className={styles.heroTitle} style={{ color: accent }}>{label}</h1>
              <div className={styles.heroMeta}>
                {loading ? (
                  <span className={styles.heroCount}>Loading…</span>
                ) : (
                  <span className={styles.heroCount}>
                    {total} title{total !== 1 ? 's' : ''}
                  </span>
                )}
                {activeGenre !== 'All' && (
                  <button
                    className={styles.heroBadge}
                    style={{ background: `${accent}18`, color: accent, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', border: 'none' }}
                    onClick={() => setActiveGenre('All')}
                    aria-label={`Remove genre filter: ${activeGenre}`}
                  >
                    {activeGenre}
                    <X size={11} />
                  </button>
                )}
                {activeFilter !== 'All' && (
                  <button
                    className={styles.heroBadge}
                    style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', border: 'none' }}
                    onClick={() => setActiveFilter('All')}
                    aria-label={`Remove access filter: ${activeFilter}`}
                  >
                    {activeFilter}
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sticky filter bar ── */}
      <div className={styles.filterBar}>
        <div className={styles.controlRow}>
          <div className={styles.controlLeft}>

            {/* Genre dropdown */}
            <div className={styles.genreDropdown} ref={genreDropdownRef}>
              <button
                className={`${styles.genreTrigger} ${activeGenre !== 'All' ? styles.genreTriggerActive : ''}`}
                style={activeGenre !== 'All' ? { '--chip-accent': accent } : {}}
                onClick={() => setGenreOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={genreOpen}
              >
                <Tag size={12} style={{ opacity: 0.6 }} />
                <span className={styles.genreTriggerText}>
                  {activeGenre === 'All' ? 'Genre' : activeGenre}
                </span>
                {activeGenre !== 'All' && (
                  <span className={styles.genreTriggerCount}>
                    {genreFacets.find((g) => g.genre === activeGenre)?.count ?? 0}
                  </span>
                )}
                <ChevronDown size={13} className={`${styles.chevron} ${genreOpen ? styles.chevronOpen : ''}`} />
              </button>

              {genreOpen && (
                <div className={styles.genrePanel} role="listbox">
                  <div className={styles.genrePanelScroll}>
                    {genreOptions.map(({ genre, count }) => {
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
            {FILTERS.map((f) => (
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
              {loading ? '…' : `${total} result${total !== 1 ? 's' : ''}`}
            </span>
            <div className={styles.sortGroup}>
              <ArrowUpDown size={11} color="rgba(255,255,255,0.35)" />
              <select className={styles.sort} value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort by">
                <option value="rating">Top Rated</option>
                <option value="newest">Newest</option>
                <option value="title">A – Z</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content grid ── */}
      {loading ? (
        <div className={styles.skeletonGrid}>
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i} className={styles.skeletonCard} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIconWrap} style={{ background: `${accent}12`, border: `1px solid ${accent}20` }}>
            <Icon size={30} style={{ color: accent, opacity: 0.6 }} />
          </div>
          <p className={styles.emptyTitle}>No titles found</p>
          <p className={styles.emptySub}>
            {hasActiveFilters
              ? 'Try removing a filter to see more titles.'
              : 'No content is available in this section yet.'}
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {hasActiveFilters && (
              <button className={styles.emptyClear} onClick={() => { setActiveGenre('All'); setActiveFilter('All') }}>
                Clear all filters
              </button>
            )}
            {activeType !== 'All' && (
              <button className={styles.emptyClear} onClick={() => navigate('/browse')}>
                Browse all content
              </button>
            )}
            <button className={styles.emptyClear} onClick={() => navigate('/')}>
              Back to Home
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.gridWrap}>
            <div className={styles.grid}>
              {items.map((item) => (
                <PosterCard
                  key={item._id || item.id}
                  item={item}
                  size="large"
                  isSubscribed={isSubscribed}
                  source="browse"
                  onClick={(clicked) => {
                    if (clicked.isPremium && !isSubscribed) openItem(clicked)
                    else navigate(`/watch/${clicked._id || clicked.id}`)
                  }}
                />
              ))}
            </div>
          </div>

          {/* Load more */}
          {hasMore && (
            <div className={styles.loadMoreWrap}>
              <button className={styles.loadMoreBtn} onClick={loadMore} disabled={loadingMore}>
                {loadingMore
                  ? <><Loader2 size={14} className={styles.loadMoreSpinner} /> Loading…</>
                  : `Load more  ·  ${total - items.length} remaining`}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildParams(type, filter, genre, sort, page) {
  return {
    type:   type   !== 'All' ? type   : undefined,
    filter: filter !== 'All' ? filter : undefined,
    genre:  genre  !== 'All' ? genre  : undefined,
    sort:   sort !== 'rating' ? sort  : undefined,
    page,
    limit:  PAGE_SIZE,
  }
}

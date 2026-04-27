import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Clock, TrendingUp, Star, Crown, Loader2, ArrowUpRight } from 'lucide-react'
import { useStore } from '../store/useStore'
import { searchContent } from '../services/api'
import styles from './SearchOverlay.module.css'

const POPULAR_TAGS  = ['Byomkesh', 'Mystery', 'Thriller', 'Drama', 'Classic', 'Detective']
const RECENT_KEY    = 'dhara_recent_searches'
const MAX_RECENT    = 6

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

function saveRecent(term) {
  const prev  = loadRecent().filter((t) => t !== term)
  const next  = [term, ...prev].slice(0, MAX_RECENT)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* noop */ }
  return next
}

export default function SearchOverlay() {
  const navigate = useNavigate()
  const { setShowSearch } = useStore()

  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [recent,   setRecent]   = useState(loadRecent)
  const inputRef   = useRef(null)
  const debounceRef= useRef(null)

  const close = useCallback(() => setShowSearch(false), [setShowSearch])

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults([]); setLoading(false); return }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchContent(query)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 280)

    return () => clearTimeout(debounceRef.current)
  }, [query])

  const handleSelect = (item) => {
    if (query.trim()) setRecent(saveRecent(query.trim()))
    close()
    navigate(`/watch/${item.id}`)
  }

  const handleTagClick = (tag) => {
    setQuery(tag)
    inputRef.current?.focus()
  }

  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY)
    setRecent([])
  }

  const showEmpty   = !loading && query.length > 1 && results.length === 0
  const showResults = !loading && results.length > 0

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Search">
      <div className={styles.inner}>

        {/* Search bar */}
        <div className={styles.searchBar}>
          {loading
            ? <Loader2 size={18} className={styles.spinIcon} />
            : <Search  size={18} className={styles.searchIcon} />
          }
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, series…"
            aria-label="Search content"
            spellCheck={false}
          />
          {query.length > 0 && (
            <button className={styles.clearBtn} onClick={() => setQuery('')} aria-label="Clear">
              <X size={16} />
            </button>
          )}
          <div className={styles.divider} />
          <button className={styles.closeBtn} onClick={close} aria-label="Close search">
            <span>Esc</span>
          </button>
        </div>

        {/* Empty state */}
        {showEmpty && (
          <div className={styles.emptyState}>
            <Search size={32} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No results for "{query}"</p>
            <p className={styles.emptySub}>Try a different title, genre, or director</p>
          </div>
        )}

        {/* Results */}
        {showResults && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <p className={styles.sectionLabel}>
                <TrendingUp size={13} /> {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className={styles.resultList}>
              {results.map((item) => (
                <button key={item.id} className={styles.resultRow} onClick={() => handleSelect(item)}>
                  {/* Poster thumbnail */}
                  <div className={styles.resultPoster} style={{ background: item.palette }}>
                    {item.posterUrl
                      ? <img src={item.posterUrl} alt={item.title} className={styles.resultPosterImg} />
                      : <Search size={14} className={styles.resultPosterFallback} />
                    }
                  </div>

                  {/* Info */}
                  <div className={styles.resultInfo}>
                    <p className={styles.resultTitle}>{item.title}</p>
                    <div className={styles.resultMeta}>
                      {item.isPremium && <Crown size={10} className={styles.crownIcon} />}
                      <span>{item.type}</span>
                      {item.genre?.length > 0 && <span>· {item.genre[0]}</span>}
                      {item.rating > 0 && (
                        <span className={styles.ratingChip}>
                          <Star size={10} fill="currentColor" /> {item.rating}
                        </span>
                      )}
                    </div>
                  </div>

                  <ArrowUpRight size={16} className={styles.resultArrow} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Default state — recent + popular */}
        {query.length < 2 && !loading && (
          <>
            {recent.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <p className={styles.sectionLabel}><Clock size={13} /> Recent</p>
                  <button className={styles.clearRecentBtn} onClick={clearRecent}>Clear</button>
                </div>
                <div className={styles.tags}>
                  {recent.map((term) => (
                    <button key={term} className={styles.recentTag} onClick={() => handleTagClick(term)}>
                      <Clock size={11} />
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <p className={styles.sectionLabel}><TrendingUp size={13} /> Popular</p>
              </div>
              <div className={styles.tags}>
                {POPULAR_TAGS.map((tag) => (
                  <button key={tag} className={styles.tag} onClick={() => handleTagClick(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

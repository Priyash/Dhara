import { useState, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { searchContent } from '../services/api'
import PosterCard from './PosterCard'
import styles from './SearchOverlay.module.css'

const POPULAR_TAGS = ['Byomkesh', 'Mahanagar', 'Eken Babu', 'Romantic', 'Thriller', 'Classic', 'Comedy']

export default function SearchOverlay() {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const inputRef = useRef(null)
  const { setShowSearch, openItem } = useStore()

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e) => e.key === 'Escape' && setShowSearch(false)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setShowSearch])

  // Debounced search against the backend
  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const timer = setTimeout(() => {
      searchContent(query).then(setResults).catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const handleCard = (item) => {
    setShowSearch(false)
    openItem(item)
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Search">
      <div className={styles.inner}>
        {/* Search bar */}
        <div className={styles.searchBar}>
          <Search size={18} color="rgba(255,255,255,0.4)" />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, series, directors…"
            aria-label="Search content"
          />
          <button onClick={() => setShowSearch(false)} className={styles.closeBtn} aria-label="Close search">
            <X size={18} />
          </button>
        </div>

        {/* Popular tags (when no query) */}
        {query.length === 0 && (
          <div>
            <p className={styles.sectionLabel}>Popular Searches</p>
            <div className={styles.tags}>
              {POPULAR_TAGS.map((tag) => (
                <button key={tag} className={styles.tag} onClick={() => setQuery(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {query.length > 1 && results.length === 0 && (
          <p className={styles.empty}>No results for "{query}"</p>
        )}

        {/* Results grid */}
        {results.length > 0 && (
          <div>
            <p className={styles.sectionLabel}>{results.length} Results</p>
            <div className={styles.results}>
              {results.map((item) => (
                <PosterCard key={item.id} item={item} onClick={handleCard} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

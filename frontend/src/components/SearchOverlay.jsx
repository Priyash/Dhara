import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, X, Clock, TrendingUp, Star, Crown, Loader2,
  ArrowUpRight, Hash, Zap, Play,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import {
  searchContent, searchReels, fetchPopularSearches, fetchContinueWatching,
} from '../services/api'
import styles from './SearchOverlay.module.css'

const FALLBACK_TAGS = ['Byomkesh', 'Mystery', 'Thriller', 'Drama', 'Classic', 'Detective']
const RECENT_KEY    = 'dhara_recent_searches'
const MAX_RECENT    = 6

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

function saveRecent(term) {
  const prev = loadRecent().filter(t => t !== term)
  const next = [term, ...prev].slice(0, MAX_RECENT)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
  return next
}

// Wraps the first match of `query` in a pink <span>. Strips leading '#' for hashtag searches.
function Highlight({ text = '', query = '' }) {
  const q = query.replace(/^#/, '').toLowerCase()
  if (!q || q.length < 2) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q)
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className={styles.highlight}>{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function SearchOverlay() {
  const navigate = useNavigate()
  const { setShowSearch, isLoggedIn } = useStore()

  const [query,            setQuery]            = useState('')
  const [results,          setResults]          = useState([])
  const [reelResults,      setReelResults]      = useState([])
  const [loading,          setLoading]          = useState(false)
  const [recent,           setRecent]           = useState(loadRecent)
  const [popularTags,      setPopularTags]      = useState(FALLBACK_TAGS)
  const [continueWatching, setContinueWatching] = useState([])
  const [focusedIndex,     setFocusedIndex]     = useState(-1)

  const inputRef        = useRef(null)
  const resultRefs      = useRef([])   // indexed by allNavigable position
  const debounceRef     = useRef(null)
  // Mutable refs so the mount-only keyboard listener always reads current values
  const focusedIndexRef = useRef(-1)
  const allNavigableRef = useRef([])
  const queryRef        = useRef('')

  const close = useCallback(() => setShowSearch(false), [setShowSearch])

  const hasQuery    = query.length >= 2
  const showEmpty   = !loading && hasQuery && results.length === 0 && reelResults.length === 0
  const showResults = !loading && hasQuery && (results.length > 0 || reelResults.length > 0)

  // Flat list of all keyboard-navigable items.
  // In search mode: content rows first, then reel cards.
  // In default mode: continue-watching rows only.
  const allNavigable = useMemo(() => {
    if (hasQuery) {
      return [
        ...results.map(item => ({ type: 'content', item })),
        ...reelResults.map(reel => ({ type: 'reel', item: reel })),
      ]
    }
    return continueWatching.map(item => ({ type: 'content', item }))
  }, [hasQuery, results, reelResults, continueWatching])

  // Keep mutable refs in sync
  useEffect(() => { focusedIndexRef.current = focusedIndex }, [focusedIndex])
  useEffect(() => { allNavigableRef.current = allNavigable }, [allNavigable])
  useEffect(() => { queryRef.current        = query },        [query])

  // Feature 5: single total result → auto-highlight so Enter immediately selects it.
  // Otherwise reset to -1 (input focus) whenever result set changes.
  useEffect(() => {
    setFocusedIndex(allNavigable.length === 1 ? 0 : -1)
  }, [allNavigable])

  // Scroll the focused item into view; when returning to -1 re-focus the input.
  useEffect(() => {
    if (focusedIndex >= 0) {
      resultRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    } else {
      inputRef.current?.focus()
    }
  }, [focusedIndex])

  // Mount: focus input, fetch popular tags + continue watching
  useEffect(() => {
    inputRef.current?.focus()
    fetchPopularSearches()
      .then(tags => { if (tags.length >= 3) setPopularTags(tags) })
      .catch(() => {})
    if (isLoggedIn) {
      fetchContinueWatching()
        .then(items => setContinueWatching(items.slice(0, 3)))
        .catch(() => {})
    }
  }, [isLoggedIn])

  // Feature 1: keyboard navigation — single mount-only listener reads mutable values via refs
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); return }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex(i => Math.min(i + 1, allNavigableRef.current.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex(i => Math.max(i - 1, -1))
        return
      }
      if (e.key === 'Enter') {
        const idx = focusedIndexRef.current
        if (idx < 0) return
        const nav = allNavigableRef.current[idx]
        if (!nav) return
        const q = queryRef.current
        if (q.trim()) setRecent(saveRecent(q.trim()))
        close()
        if (nav.type === 'content') navigate(`/watch/${nav.item.id}`)
        else                        navigate(`/reels/${nav.item._id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, navigate])

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults([]); setReelResults([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const [content, reels] = await Promise.all([
          searchContent(query),
          isLoggedIn ? searchReels(query) : [],
        ])
        setResults(content)
        setReelResults(reels)
      } catch {
        setResults([]); setReelResults([])
      } finally {
        setLoading(false)
      }
    }, 280)
    return () => clearTimeout(debounceRef.current)
  }, [query, isLoggedIn])

  // useCallback so keyboard Enter handler gets stable function references via closure
  const handleSelect = useCallback((item) => {
    const q = queryRef.current
    if (q.trim()) setRecent(saveRecent(q.trim()))
    close()
    navigate(`/watch/${item.id}`)
  }, [close, navigate])

  const handleReelSelect = useCallback((reel) => {
    const q = queryRef.current
    if (q.trim()) setRecent(saveRecent(q.trim()))
    close()
    navigate(`/reels/${reel._id}`)
  }, [close, navigate])

  const handleTagClick = (tag) => {
    setQuery(tag)
    setFocusedIndex(-1)
    inputRef.current?.focus()
  }

  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY)
    setRecent([])
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Search">
      <div className={styles.inner}>

        {/* ── Search bar ── */}
        <div className={styles.searchBar}>
          {loading
            ? <Loader2 size={18} className={styles.spinIcon} />
            : <Search  size={18} className={styles.searchIcon} />
          }
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={e => { setQuery(e.target.value); setFocusedIndex(-1) }}
            placeholder="Search movies, series, reels…"
            aria-label="Search"
            spellCheck={false}
            autoComplete="off"
          />
          {query.length > 0 && (
            <button
              className={styles.clearBtn}
              onClick={() => { setQuery(''); setFocusedIndex(-1) }}
              aria-label="Clear"
            >
              <X size={16} />
            </button>
          )}
          <div className={styles.divider} />
          <button className={`${styles.closeBtn} ${styles.closeBtnDesktop}`} onClick={close} aria-label="Close search">
            <span>Esc</span>
          </button>
          <button className={`${styles.closeBtn} ${styles.closeBtnMobile}`} onClick={close} aria-label="Close search">
            <X size={14} />
          </button>
        </div>

        {/* ── Empty state ── */}
        {showEmpty && (
          <div className={styles.emptyState}>
            <Search size={32} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No results for "{query}"</p>
            <p className={styles.emptySub}>
              {query.startsWith('#')
                ? 'No reels with this hashtag yet'
                : 'Try a different title, genre, director, or #hashtag'}
            </p>
          </div>
        )}

        {/* ── Unified results ── */}
        {showResults && (
          <>
            {/* Feature 2: Content rows — stagger in from below */}
            {results.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <p className={styles.sectionLabel}><TrendingUp size={12} /> Movies &amp; Series</p>
                  <span className={styles.sectionCount}>{results.length}</span>
                </div>
                <div className={styles.resultList}>
                  {results.map((item, i) => (
                    <button
                      key={item.id}
                      ref={el => { resultRefs.current[i] = el }}
                      className={`${styles.resultRow} ${focusedIndex === i ? styles.resultRowFocused : ''}`}
                      style={{ animationDelay: `${i * 35}ms` }}
                      onClick={() => handleSelect(item)}
                      aria-selected={focusedIndex === i}
                    >
                      <div className={styles.resultPoster} style={{ background: item.palette }}>
                        {item.posterUrl
                          ? <img src={item.posterUrl} alt={item.title} className={styles.resultPosterImg} />
                          : <Search size={14} className={styles.resultPosterFallback} />
                        }
                      </div>
                      <div className={styles.resultInfo}>
                        <p className={styles.resultTitle}>
                          <Highlight text={item.title} query={query} />
                        </p>
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

            {/* Reel results — rows with 9:16 thumbnail, consistent with content rows */}
            {reelResults.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <p className={styles.sectionLabel}><Zap size={12} /> Reels</p>
                  <span className={styles.sectionCount}>{reelResults.length} clips</span>
                </div>
                <div className={styles.resultList}>
                  {reelResults.map((reel, i) => {
                    const navIdx     = results.length + i
                    const creator    = reel.creatorId
                    const studioName = creator?.creatorProfile?.studioName || creator?.displayName || ''
                    return (
                      <button
                        key={reel._id}
                        ref={el => { resultRefs.current[navIdx] = el }}
                        className={`${styles.resultRow} ${focusedIndex === navIdx ? styles.resultRowFocused : ''}`}
                        style={{ animationDelay: `${i * 35}ms` }}
                        onClick={() => handleReelSelect(reel)}
                        aria-selected={focusedIndex === navIdx}
                      >
                        <div
                          className={styles.reelResultPoster}
                          style={reel.thumbnailUrl ? {
                            backgroundImage: `url(${reel.thumbnailUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          } : undefined}
                        />
                        <div className={styles.resultInfo}>
                          <p className={styles.resultTitle}>
                            <Highlight text={reel.title || 'Untitled'} query={query} />
                          </p>
                          <div className={styles.resultMeta}>
                            <span className={styles.reelBadge}><Zap size={9} /> Reel</span>
                            {studioName && <span>{studioName}</span>}
                            {reel.hashtags?.length > 0 && <span>#{reel.hashtags[0]}</span>}
                          </div>
                        </div>
                        <ArrowUpRight size={16} className={styles.resultArrow} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Default state ── */}
        {!hasQuery && !loading && (
          <>
            {/* Feature 4: Continue watching — first, most actionable */}
            {isLoggedIn && continueWatching.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <p className={styles.sectionLabel}><Play size={12} /> Continue Watching</p>
                </div>
                <div className={styles.resultList}>
                  {continueWatching.map((item, i) => (
                    <button
                      key={item.id || item._id}
                      ref={el => { resultRefs.current[i] = el }}
                      className={`${styles.resultRow} ${focusedIndex === i ? styles.resultRowFocused : ''}`}
                      onClick={() => handleSelect(item)}
                      aria-selected={focusedIndex === i}
                    >
                      <div className={styles.resultPoster} style={{ background: item.palette }}>
                        {item.posterUrl
                          ? <img src={item.posterUrl} alt={item.title} className={styles.resultPosterImg} />
                          : <Play size={14} className={styles.resultPosterFallback} />
                        }
                      </div>
                      <div className={styles.resultInfo}>
                        <p className={styles.resultTitle}>{item.title}</p>
                        <div className={styles.resultMeta}>
                          {item.isPremium && <Crown size={10} className={styles.crownIcon} />}
                          <span>{item.type}</span>
                          {item.genre?.length > 0 && <span>· {item.genre[0]}</span>}
                        </div>
                        {(item.progressPct ?? 0) > 0 && (
                          <div className={styles.progressBar}>
                            <div className={styles.progressFill} style={{ width: `${item.progressPct}%` }} />
                          </div>
                        )}
                      </div>
                      <ArrowUpRight size={16} className={styles.resultArrow} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recent searches */}
            {recent.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <p className={styles.sectionLabel}><Clock size={13} /> Recent</p>
                  <button className={styles.clearRecentBtn} onClick={clearRecent}>Clear</button>
                </div>
                <div className={styles.tags}>
                  {recent.map(term => (
                    <button key={term} className={styles.recentTag} onClick={() => handleTagClick(term)}>
                      <Clock size={11} />{term}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Popular tags */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <p className={styles.sectionLabel}><TrendingUp size={13} /> Popular</p>
              </div>
              <div className={styles.tags}>
                {popularTags.map(tag => (
                  <button key={tag} className={styles.tag} onClick={() => handleTagClick(tag)}>{tag}</button>
                ))}
              </div>
            </div>

            {/* Hashtag hint */}
            {isLoggedIn && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <p className={styles.sectionLabel}><Hash size={13} /> Search reels by hashtag</p>
                </div>
                <p className={styles.reelHint}>
                  Type <code className={styles.reelHintCode}>#comedy</code> to search reels by topic
                </p>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

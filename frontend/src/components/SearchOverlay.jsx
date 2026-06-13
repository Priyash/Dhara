import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Clock, TrendingUp, Star, Crown, Loader2, ArrowUpRight, Hash, Zap, Play } from 'lucide-react'
import { useStore } from '../store/useStore'
import { searchContent, searchReels, fetchPopularSearches } from '../services/api'
import styles from './SearchOverlay.module.css'

const FALLBACK_TAGS = ['Byomkesh', 'Mystery', 'Thriller', 'Drama', 'Classic', 'Detective']
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

function fmt(n) {
  if (!n) return '0'
  if (n >= 1000) return `${(n/1000).toFixed(1)}k`
  return String(n)
}

export default function SearchOverlay() {
  const navigate = useNavigate()
  const { setShowSearch, isLoggedIn } = useStore()

  const [query,         setQuery]         = useState('')
  const [tab,           setTab]           = useState('content')   // 'content' | 'reels'
  const [results,       setResults]       = useState([])
  const [reelResults,   setReelResults]   = useState([])
  const [loading,       setLoading]       = useState(false)
  const [recent,        setRecent]        = useState(loadRecent)
  const [popularTags,   setPopularTags]   = useState(FALLBACK_TAGS)
  const inputRef    = useRef(null)
  const debounceRef = useRef(null)

  const close = useCallback(() => setShowSearch(false), [setShowSearch])

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    fetchPopularSearches()
      .then((tags) => { if (tags.length >= 3) setPopularTags(tags) })
      .catch(() => {})
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // Auto-switch to reels tab when query starts with '#'
  useEffect(() => {
    if (query.startsWith('#') && tab !== 'reels') setTab('reels')
  }, [query])

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

  const handleSelect = (item) => {
    if (query.trim()) setRecent(saveRecent(query.trim()))
    close()
    navigate(`/watch/${item.id}`)
  }

  const handleReelSelect = (reel) => {
    if (query.trim()) setRecent(saveRecent(query.trim()))
    close()
    navigate(`/reels/${reel._id}`)
  }

  const handleTagClick = (tag) => {
    setQuery(tag)
    inputRef.current?.focus()
  }

  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY)
    setRecent([])
  }

  const hasQuery    = query.length >= 2
  const showEmpty   = !loading && hasQuery && results.length === 0 && reelResults.length === 0
  const showResults = !loading && hasQuery && (results.length > 0 || reelResults.length > 0)
  const activeResults = tab === 'reels' ? reelResults : results

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
            placeholder="Search movies, series, #reels…"
            aria-label="Search"
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

        {/* Tab switcher — only when there are results */}
        {showResults && (
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabBtn} ${tab === 'content' ? styles.tabBtnActive : ''}`}
              onClick={() => setTab('content')}
            >
              <TrendingUp size={12} /> Content
              {results.length > 0 && <span className={styles.tabCount}>{results.length}</span>}
            </button>
            <button
              className={`${styles.tabBtn} ${tab === 'reels' ? styles.tabBtnActive : ''}`}
              onClick={() => setTab('reels')}
            >
              <Zap size={12} /> Reels
              {reelResults.length > 0 && <span className={styles.tabCount}>{reelResults.length}</span>}
            </button>
          </div>
        )}

        {/* Empty state */}
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

        {/* Content results */}
        {showResults && tab === 'content' && results.length > 0 && (
          <div className={styles.section}>
            <div className={styles.resultList}>
              {results.map((item) => (
                <button key={item.id} className={styles.resultRow} onClick={() => handleSelect(item)}>
                  <div className={styles.resultPoster} style={{ background: item.palette }}>
                    {item.posterUrl
                      ? <img src={item.posterUrl} alt={item.title} className={styles.resultPosterImg} />
                      : <Search size={14} className={styles.resultPosterFallback} />
                    }
                  </div>
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

        {/* Reel results */}
        {showResults && tab === 'reels' && (
          reelResults.length === 0 ? (
            <div className={styles.emptyState}>
              <Zap size={28} className={styles.emptyIcon} />
              <p className={styles.emptyTitle}>No reels found</p>
              <p className={styles.emptySub}>
                {query.startsWith('#') ? `No reels tagged ${query}` : 'Try searching with a #hashtag'}
              </p>
            </div>
          ) : (
            <div className={styles.section}>
              <div className={styles.reelResultGrid}>
                {reelResults.map((reel) => {
                  const creator    = reel.creatorId
                  const studioName = creator?.creatorProfile?.studioName || creator?.displayName || ''
                  return (
                    <button key={reel._id} className={styles.reelResultCard} onClick={() => handleReelSelect(reel)}>
                      {/* 9:16 thumbnail */}
                      <div
                        className={styles.reelResultThumb}
                        style={reel.thumbnailUrl
                          ? { backgroundImage: `url(${reel.thumbnailUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                          : { background: 'linear-gradient(160deg,#1e1b4b,#7c3aed)' }
                        }
                      >
                        <div className={styles.reelResultPlay}><Play size={14} fill="#fff" /></div>
                        {reel.durationSecs > 0 && (
                          <span className={styles.reelResultDur}>{reel.durationSecs}s</span>
                        )}
                      </div>

                      {/* Caption + meta */}
                      <div className={styles.reelResultInfo}>
                        <p className={styles.reelResultTitle}>
                          {reel.title || <em className={styles.reelResultNoCaption}>No caption</em>}
                        </p>
                        {studioName && <p className={styles.reelResultCreator}>{studioName}</p>}
                        {reel.hashtags?.length > 0 && (
                          <p className={styles.reelResultTags}>
                            #{reel.hashtags.slice(0, 2).join(' #')}
                          </p>
                        )}
                        <div className={styles.reelResultStats}>
                          <span><Play size={9} /> {fmt(reel.viewCount || 0)}</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        )}

        {/* Default state — recent + popular */}
        {!hasQuery && !loading && (
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
                {popularTags.map((tag) => (
                  <button key={tag} className={styles.tag} onClick={() => handleTagClick(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>

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

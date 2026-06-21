import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Heart, MessageCircle, ChevronLeft, Volume2, VolumeX,
  ChevronUp, ChevronDown, Send, Loader2, Hash, X, Trash2,
  Play, Eye, TrendingUp, Zap, Share2,
} from 'lucide-react'
import Hls from 'hls.js'
import { useStore } from '../store/useStore'
import {
  fetchReels, fetchReelById, fetchReelStreamUrl, recordReelView, likeReel,
  fetchReelComments, postReelComment, deleteReelComment,
  recordInteractionEvent, getMe, fetchReelHashtags,
} from '../services/api'
import VerifiedBadge from '../components/VerifiedBadge'
import styles from './Reels.module.css'

const VIEW_THRESHOLD = 5

function fmt(n) {
  if (!n || n < 1000) return String(n || 0)
  if (n < 1_000_000)  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

function timeAgo(iso) {
  if (!iso) return ''
  const m = Math.floor((Date.now() - new Date(iso)) / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ── Root component — routes to grid or player based on URL ───────────────────

export default function Reels() {
  const { id } = useParams()
  return id ? <ReelPlayer startId={id} /> : <ReelGrid />
}

// ── Grid / browse mode ────────────────────────────────────────────────────────

function ReelGrid() {
  const navigate = useNavigate()
  const { isLoggedIn, authLoading, openAuth } = useStore()

  const [tab,         setTab]         = useState('newest')
  const [hashtag,     setHashtag]     = useState('')
  const [reels,       setReels]       = useState([])
  const [total,       setTotal]       = useState(0)
  const [page,        setPage]        = useState(1)
  const [hasMore,     setHasMore]     = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [topHashtags, setTopHashtags] = useState([])

  const sentinelRef = useRef(null)

  // Fetch top hashtags from backend — handles thousands of tags without client-side aggregation
  useEffect(() => {
    fetchReelHashtags({ limit: 15 })
      .then(tags => setTopHashtags(tags))
      .catch(() => {})
  }, [])

  const load = useCallback(async (sort, tag, pg) => {
    try {
      const params = { sort, limit: 20, page: pg }
      if (tag) params.hashtag = tag
      const data = await fetchReels(params)
      const items = data.items || []
      if (pg === 1) setReels(items)
      else          setReels((prev) => [...prev, ...items])
      setTotal(data.total || 0)
      setHasMore((data.page || 1) < (data.pages || 1))
    } catch {
      if (pg === 1) setReels([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    setLoading(true)
    setPage(1)
    load(tab, hashtag, 1)
  }, [tab, hashtag, load, authLoading])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    const next = page + 1
    setPage(next)
    setLoadingMore(true)
    load(tab, hashtag, next)
  }, [loadingMore, hasMore, page, tab, hashtag, load])

  // Infinite scroll — trigger loadMore when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const handleReelClick = (reel) => {
    if (!isLoggedIn) {
      openAuth('signin')
      return
    }
    navigate(`/reels/${reel._id}`)
  }

  return (
    <div className={styles.gridRoot}>

      {/* ── Header ── */}
      <div className={styles.gridHeader}>
        <div className={styles.gridHeaderLeft}>
          <Zap size={18} className={styles.gridHeaderIcon} />
          <h1 className={styles.gridTitle}>Reels</h1>
          <span className={styles.gridCount}>{total > 0 ? `${fmt(total)} clips` : ''}</span>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className={styles.gridTabs}>
        <button
          className={`${styles.gridTab} ${tab === 'newest' ? styles.gridTabActive : ''}`}
          onClick={() => setTab('newest')}
        >
          <Zap size={12} /> For You
        </button>
        <button
          className={`${styles.gridTab} ${tab === 'trending' ? styles.gridTabActive : ''}`}
          onClick={() => setTab('trending')}
        >
          <TrendingUp size={12} /> Trending
        </button>
      </div>

      {/* ── Topic filter bar — chips sourced from backend aggregation ── */}
      {topHashtags.length > 0 && (
        <div className={styles.topicBar}>
          {hashtag && (
            <button className={`${styles.chip} ${styles.chipActive}`} onClick={() => setHashtag('')}>
              <Hash size={10} />{hashtag} <X size={10} />
            </button>
          )}
          {topHashtags
            .filter(({ tag }) => tag !== hashtag)
            .map(({ tag, count }) => (
              <button key={tag} className={styles.chip} onClick={() => setHashtag(tag)}>
                <Hash size={10} />{tag}
                <span className={styles.chipCount}>{count}</span>
              </button>
            ))}
        </div>
      )}

      {/* ── Grid ── */}
      {loading ? (
        <div className={styles.gridSkeleton}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={styles.skelCard} />
          ))}
        </div>
      ) : reels.length === 0 ? (
        <div className={styles.gridEmpty}>
          <Zap size={32} className={styles.gridEmptyIcon} />
          <p className={styles.gridEmptyTitle}>No reels yet</p>
          <p className={styles.gridEmptySub}>
            {hashtag ? `No reels tagged #${hashtag}` : 'Creators are uploading — check back soon'}
          </p>
          {hashtag && (
            <button className={styles.gridEmptyClear} onClick={() => setHashtag('')}>
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {reels.map((reel) => (
              <ReelCard key={reel._id} reel={reel} showGate={!isLoggedIn} onClick={() => handleReelClick(reel)} />
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} className={styles.sentinel} />}
          {loadingMore && (
            <div className={styles.feedLoader}>
              <Loader2 size={20} className={styles.spin} />
            </div>
          )}
        </>
      )}

    </div>
  )
}

// ── Individual grid card ──────────────────────────────────────────────────────

function ReelCard({ reel, onClick, showGate = false }) {
  const creator    = reel.creatorId
  const studioName = creator?.creatorProfile?.studioName || creator?.displayName || ''

  return (
    <article
      className={styles.card}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={reel.title || 'Reel'}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className={styles.cardPoster}>
        {reel.thumbnailUrl && (
          <img
            src={reel.thumbnailUrl}
            alt={reel.title || 'Reel'}
            className={styles.cardPosterImg}
            loading="lazy"
            decoding="async"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}

        <div className={styles.cardGradient} aria-hidden="true" />

        {/* Views — top left */}
        {(reel.viewCount || 0) > 0 && (
          <div className={styles.cardInfoViews} aria-hidden="true">
            <Eye size={10} />{fmt(reel.viewCount)}
          </div>
        )}

        {/* Duration — top right */}
        {reel.durationSecs > 0 && (
          <div className={styles.cardDur}>{reel.durationSecs}s</div>
        )}

        {/* Hover play button */}
        <div className={styles.cardPlayBtn} aria-hidden="true">
          <Play size={17} fill="#fff" style={{ marginLeft: 2 }} />
        </div>

        {/* Gate */}
        {showGate && (
          <div className={styles.cardGate}>Sign in to watch</div>
        )}

        {/* Info panel */}
        <div className={styles.cardInfo}>
          {studioName && <p className={styles.cardInfoCreator}>{studioName}</p>}
          {reel.title && <p className={styles.cardInfoTitle}>{reel.title}</p>}
          {reel.hashtags?.length > 0 && (
            <div className={styles.cardInfoTags}>
              {reel.hashtags.slice(0, 2).map(t => (
                <span key={t} className={styles.cardInfoTag}>#{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

// ── Full-screen player mode ───────────────────────────────────────────────────

function ReelPlayer({ startId }) {
  const navigate = useNavigate()
  const { isLoggedIn, authLoading, user, openAuth } = useStore()

  const [reels,       setReels]       = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [muted,       setMuted]       = useState(true)
  const [streamUrls,  setStreamUrls]  = useState({})
  const [likedIds,    setLikedIds]    = useState(new Set())
  const [stats,       setStats]       = useState({})

  const [commentsFor,    setCommentsFor]    = useState(null)
  const [comments,       setComments]       = useState([])
  const [commentText,    setCommentText]    = useState('')
  const [commentsTotal,  setCommentsTotal]  = useState(0)
  const [commentPage,    setCommentPage]    = useState(1)
  const [commentLoading, setCommentLoading] = useState(false)
  const [postingComment, setPostingComment] = useState(false)

  const [userPaused, setUserPaused] = useState(false)
  const [feedPage,    setFeedPage]    = useState(1)
  const [feedHasMore, setFeedHasMore] = useState(true)
  const feedLoadingRef  = useRef(false)
  const streamFetchRef  = useRef(new Set())

  const viewRecordedRef = useRef(new Set())
  const milestoneRef    = useRef(new Set())
  const commentInputRef = useRef(null)
  const stageRef         = useRef(null)
  const swipeStartRef    = useRef(null)
  const mouseDownRef     = useRef(null)   // desktop drag/click tracking
  const lastTouchRef     = useRef(0)      // suppress synthetic mouse events after touch
  const wheelCooldownRef = useRef(false)  // debounce wheel navigation

  // Hide the global navbar while the full-screen reel player is active
  useEffect(() => {
    document.body.classList.add('reel-playing')
    return () => document.body.classList.remove('reel-playing')
  }, [])

  useEffect(() => {
    if (authLoading || !isLoggedIn) return
    setLoading(true)

    const run = async () => {
      // Fetch reels and current user in parallel — both need a valid token,
      // which is guaranteed because authLoading=false means Firebase is ready.
      const [feedData, freshUser] = await Promise.all([
        fetchReels({ limit: 40 }),
        getMe(),   // no catch — let it throw so we don't silently seed empty likedIds
      ])

      let items = feedData?.items || []

      // Deep-link: if the specific reel isn't in the first page, fetch it and prepend
      if (startId && !items.find(r => r._id === startId)) {
        try {
          const single = await fetchReelById(startId)
          // fetchReelById returns a normalizeItem-ed object (has id, not _id)
          if (single) {
            const normalised = { ...single, _id: String(single._id || single.id) }
            items = [normalised, ...items]
          }
        } catch { /* reel private/deleted — show feed from start */ }
      }

      // Seed stats and liked state from fresh DB data
      const s = {}
      const likedContent = freshUser?.likedContent || []
      const liked = new Set()
      items.forEach((r) => {
        const id = String(r._id || r.id)
        s[id] = { viewCount: r.viewCount || 0, likeCount: r.likeCount || 0, commentCount: r.commentCount || 0 }
        if (likedContent.some(lc => String(lc) === id)) liked.add(id)
      })

      setReels(items)
      setStats(s)
      setLikedIds(liked)
      const idx = items.findIndex(r => String(r._id || r.id) === startId)
      if (idx >= 0) setActiveIndex(idx)
    }

    run()
      .catch((err) => console.error('[reels load]', err?.message))
      .finally(() => setLoading(false))
  }, [authLoading, isLoggedIn])

  useEffect(() => {
    if (!reels.length) return
    ;[activeIndex - 1, activeIndex, activeIndex + 1]
      .filter((i) => i >= 0 && i < reels.length)
      .forEach((i) => {
        const reel = reels[i]
        if (!reel) return
        const id = String(reel._id || reel.id)
        if (id in streamUrls || streamFetchRef.current.has(id)) return
        if (reel.videoUrl) {
          setStreamUrls((p) => ({ ...p, [id]: reel.videoUrl }))
          return
        }
        streamFetchRef.current.add(id)
        fetchReelStreamUrl(id)
          .then(({ hlsUrl, videoUrl }) => {
            const url = hlsUrl || videoUrl
            setStreamUrls((p) => ({ ...p, [id]: url || null }))
          })
          .catch((err) => {
            console.error('[reel:stream]', id, err?.message)
            setStreamUrls((p) => ({ ...p, [id]: null }))
          })
          .finally(() => streamFetchRef.current.delete(id))
      })
  }, [activeIndex, reels]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load more reels when approaching the end of the current batch
  useEffect(() => {
    if (!feedHasMore || feedLoadingRef.current || !reels.length) return
    if (activeIndex < reels.length - 4) return
    feedLoadingRef.current = true
    const nextPage = feedPage + 1
    fetchReels({ limit: 20, page: nextPage })
      .then((data) => {
        const items = data?.items || []
        if (!items.length || (data.page || 1) >= (data.pages || 1)) { setFeedHasMore(false); return }
        setReels((prev) => {
          const seen = new Set(prev.map((r) => String(r._id || r.id)))
          return [...prev, ...items.filter((r) => !seen.has(String(r._id || r.id)))]
        })
        setStats((prev) => {
          const s = { ...prev }
          items.forEach((r) => {
            const id = String(r._id || r.id)
            if (!s[id]) s[id] = { viewCount: r.viewCount || 0, likeCount: r.likeCount || 0, commentCount: r.commentCount || 0 }
          })
          return s
        })
        setFeedPage(nextPage)
      })
      .catch(() => {})
      .finally(() => { feedLoadingRef.current = false })
  }, [activeIndex, reels.length, feedHasMore, feedPage])

  const goTo = useCallback((idx) => {
    if (idx < 0 || idx >= reels.length) return
    setActiveIndex(idx)
    setUserPaused(false)
    navigate(`/reels/${reels[idx]._id}`, { replace: true })
  }, [reels, navigate])

  const handleStageTouchStart = useCallback((e) => {
    lastTouchRef.current = Date.now() // mark so mouseDown ignores synthetic events
    if (commentsFor) return
    const t = e.touches[0]
    swipeStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }, [commentsFor])

  // ── Desktop mouse: click to pause, drag to navigate ──────────────────────────
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    if (Date.now() - lastTouchRef.current < 700) return // ignore synthesized mouse events from touch
    mouseDownRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseUp = useCallback((e) => {
    const start = mouseDownRef.current
    mouseDownRef.current = null
    if (!start || commentsFor) return
    if (Date.now() - lastTouchRef.current < 700) return
    if (e.target.closest('button, a, input')) return // UI elements handle themselves

    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const dist = Math.max(Math.abs(dx), Math.abs(dy))

    if (dist < 10) {
      // Click — toggle pause
      setUserPaused(p => !p)
    } else if (dist > 50) {
      // Drag — navigate; support both vertical and horizontal drag
      const isHorizontal = Math.abs(dx) >= Math.abs(dy)
      if (isHorizontal) {
        if (dx < 0) goTo(activeIndex + 1) // drag left  = next
        else        goTo(activeIndex - 1) // drag right = previous
      } else {
        if (dy < 0) goTo(activeIndex + 1) // drag up   = next
        else        goTo(activeIndex - 1) // drag down  = previous
      }
    }
  }, [commentsFor, goTo, activeIndex])

  // ── Desktop scroll wheel: navigate reels ─────────────────────────────────────
  const handleWheel = useCallback((e) => {
    if (commentsFor || wheelCooldownRef.current) return
    wheelCooldownRef.current = true
    setTimeout(() => { wheelCooldownRef.current = false }, 700)
    if (e.deltaY > 0 || e.deltaX > 0) goTo(activeIndex + 1)
    else                               goTo(activeIndex - 1)
  }, [commentsFor, goTo, activeIndex])

  const handleStageTouchEnd = useCallback((e) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start || commentsFor) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const elapsed = Date.now() - start.t
    const rect = stageRef.current?.getBoundingClientRect()

    // Exclude edges where UI elements live:
    //   right 20 %  → like / comment / view buttons
    //   top  18 %   → back / mute floating buttons
    //   bottom 24 % → nav arrows + creator meta
    if (rect) {
      const rx = (start.x - rect.left)  / rect.width
      const ry = (start.y - rect.top)   / rect.height
      if (rx > 0.80 || ry < 0.18 || ry > 0.76) return
    }

    // Tap (small movement, quick) → toggle pause
    if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && elapsed < 300) {
      setUserPaused(p => !p)
      return
    }

    // Swipe right → native share
    if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 1.5 && elapsed < 500 && navigator.share) {
      const reel = reels[activeIndex]
      if (reel) {
        navigator.share({
          title: reel.title || 'Check this out on Dhara',
          url: window.location.href,
        }).catch(() => {})
      }
      return
    }

    // Vertical swipe → navigate
    if (Math.abs(dy) > Math.abs(dx) * 1.3 && Math.abs(dy) > 55 && elapsed < 500) {
      if (dy < 0) goTo(activeIndex + 1)
      else        goTo(activeIndex - 1)
    }
  }, [commentsFor, activeIndex, goTo, reels])

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') {
        if (commentsFor) setCommentsFor(null)
        else navigate('/reels')
        return
      }
      if (commentsFor) return  // other keys blocked while drawer is open
      if (e.key === 'ArrowDown'  || e.key === 'j' || e.key === 'ArrowRight') goTo(activeIndex + 1)
      if (e.key === 'ArrowUp'    || e.key === 'k' || e.key === 'ArrowLeft')  goTo(activeIndex - 1)
      if (e.key === 'm') setMuted((m) => !m)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [activeIndex, goTo, commentsFor, navigate])

  const handleLike = async (reelId) => {
    if (!isLoggedIn) { openAuth('signin'); return }
    const id = String(reelId)
    const was = likedIds.has(id)

    // Optimistic
    setLikedIds((p) => { const n = new Set(p); was ? n.delete(id) : n.add(id); return n })
    setStats((p) => ({
      ...p,
      [id]: { ...(p[id] || {}), likeCount: Math.max(0, (p[id]?.likeCount || 0) + (was ? -1 : 1)) },
    }))

    try {
      const res = await likeReel(id)
      if (!res) return   // empty response — keep optimistic, will reconcile on next mount

      const serverLiked = Boolean(res.liked)
      const serverCount = typeof res.likeCount === 'number' ? res.likeCount : null

      // Always reconcile from server — this is the source of truth
      setLikedIds((p) => { const n = new Set(p); serverLiked ? n.add(id) : n.delete(id); return n })
      if (serverCount !== null) {
        setStats((p) => ({ ...p, [id]: { ...(p[id] || {}), likeCount: serverCount } }))
        setReels((prev) => prev.map(r => String(r._id || r.id) === id ? { ...r, likeCount: serverCount } : r))
      }
    } catch (err) {
      console.error('[like] network error:', err?.message)
      // Revert only on genuine network/auth failure
      setLikedIds((p) => { const n = new Set(p); was ? n.add(id) : n.delete(id); return n })
      setStats((p) => ({
        ...p,
        [id]: { ...(p[id] || {}), likeCount: Math.max(0, (p[id]?.likeCount || 0) + (was ? 1 : -1)) },
      }))
    }
  }

  const openComments = async (reelId) => {
    if (!isLoggedIn) { openAuth('signin'); return }
    setCommentsFor(reelId)
    setComments([])
    setCommentPage(1)
    setCommentLoading(true)
    fetchReelComments(reelId, { page: 1, limit: 20 })
      .then(({ comments: c = [], total = 0 }) => { setComments(c); setCommentsTotal(total) })
      .finally(() => { setCommentLoading(false); setTimeout(() => commentInputRef.current?.focus(), 250) })
  }

  const loadMoreComments = () => {
    if (!commentsFor || commentLoading) return
    const next = commentPage + 1
    setCommentLoading(true)
    fetchReelComments(commentsFor, { page: next, limit: 20 })
      .then(({ comments: c = [] }) => { setComments((p) => [...p, ...c]); setCommentPage(next) })
      .finally(() => setCommentLoading(false))
  }

  const submitComment = async (e) => {
    e.preventDefault()
    if (!commentText.trim() || !commentsFor || postingComment) return
    setPostingComment(true)
    try {
      const created = await postReelComment(commentsFor, commentText.trim())
      setComments((p) => [created, ...p])
      setCommentsTotal((n) => n + 1)
      setStats((p) => ({ ...p, [commentsFor]: { ...(p[commentsFor] || {}), commentCount: (p[commentsFor]?.commentCount || 0) + 1 } }))
      setCommentText('')
    } catch {}
    setPostingComment(false)
  }

  const deleteComment = async (commentId) => {
    try {
      await deleteReelComment(commentsFor, commentId)
      setComments((p) => p.filter((c) => c._id !== commentId))
      setCommentsTotal((n) => Math.max(0, n - 1))
      setStats((p) => ({ ...p, [commentsFor]: { ...(p[commentsFor] || {}), commentCount: Math.max(0, (p[commentsFor]?.commentCount || 0) - 1) } }))
    } catch {}
  }

  if (!isLoggedIn) return (
    <div className={styles.gate}>
      <div className={styles.gateCard}>
        <div className={styles.gateIcon}><Play size={26} strokeWidth={1.5} /></div>
        <h2 className={styles.gateTitle}>Reels</h2>
        <p className={styles.gateSub}>Short clips &amp; moments from Bengali creators</p>
        <div className={styles.gateActions}>
          <button className={styles.gateBtn} onClick={() => openAuth('signin', '/reels')}>Sign in to watch</button>
          <button className={styles.gateBtnGhost} onClick={() => openAuth('signup', '/reels')}>Create Free Account</button>
        </div>
        <p className={styles.gateFine}>Free trial available · No credit card required</p>
      </div>
    </div>
  )

  if (loading) return <div className={styles.gate}><Loader2 size={26} className={styles.spin} /></div>

  if (!reels.length) return (
    <div className={styles.gate}>
      <div className={styles.gateCard}>
        <p className={styles.gateTitle}>No reels yet</p>
        <button className={styles.gateBtn} onClick={() => navigate('/reels')}>Back to Reels</button>
      </div>
    </div>
  )

  return (
    <div className={styles.root}>
      <div
        ref={stageRef}
        className={styles.stage}
        onTouchStart={handleStageTouchStart}
        onTouchEnd={handleStageTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      >
        {reels.map((reel, i) => (
          <ReelSlide
            key={reel._id}
            reel={reel}
            isActive={i === activeIndex}
            userPaused={i === activeIndex && userPaused}
            hlsUrl={streamUrls[String(reel._id)]}
            muted={muted}
            liked={likedIds.has(String(reel._id))}
            reelStats={stats[String(reel._id)] || {}}
            onLike={() => handleLike(String(reel._id))}
            onComment={() => openComments(String(reel._id))}
            onMuteToggle={() => setMuted(m => !m)}
            viewRecordedRef={viewRecordedRef}
            milestoneRef={milestoneRef}
            onViewCounted={(s) => setStats((p) => ({ ...p, [String(reel._id)]: { ...(p[String(reel._id)] || {}), ...s } }))}
          />
        ))}

        {/* Back — "< Reels" label style (YouTube Shorts / TikTok) */}
        <button className={styles.btnBack} onClick={() => navigate('/reels')} aria-label="Back to Reels">
          <ChevronLeft size={24} /> Reels
        </button>

        {/* Nav arrows */}
        <div className={styles.navCol}>
          <button className={styles.navArrow} onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}>
            <ChevronUp size={18} />
          </button>
          <span className={styles.navNum}>{activeIndex + 1}<em>/{reels.length}</em></span>
          <button className={styles.navArrow} onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === reels.length - 1 && !feedHasMore}>
            <ChevronDown size={18} />
          </button>
        </div>

        {/* Comment drawer inside stage — keeps actions sidebar (z:30) above backdrop (z:25) */}
        {commentsFor && (
          <div className={styles.backdrop} onClick={() => setCommentsFor(null)}>
            <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
              <div className={styles.drawerPill} />
              <div className={styles.drawerHead}>
                <span className={styles.drawerLabel}>
                  Comments
                  {commentsTotal > 0 && <span className={styles.drawerBadge}>{commentsTotal.toLocaleString()}</span>}
                </span>
                <button className={styles.drawerX} onClick={() => setCommentsFor(null)}><X size={17} /></button>
              </div>
              <div className={styles.commentScroll}>
                {commentLoading && !comments.length
                  ? <div className={styles.center}><Loader2 size={20} className={styles.spin} /></div>
                  : !comments.length
                  ? <p className={styles.emptyMsg}>No comments yet. Be the first.</p>
                  : <>
                      {comments.map((c) => (
                        <CommentRow key={c._id} comment={c} currentUserId={user?._id || user?.id} onDelete={() => deleteComment(c._id)} />
                      ))}
                      {comments.length < commentsTotal && (
                        <button className={styles.loadMore} onClick={loadMoreComments} disabled={commentLoading}>
                          {commentLoading ? <Loader2 size={13} className={styles.spin} /> : 'Load more'}
                        </button>
                      )}
                    </>
                }
              </div>
              <form className={styles.commentBar} onSubmit={submitComment}>
                <input
                  ref={commentInputRef}
                  className={styles.commentInput}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment…"
                  maxLength={500}
                  autoComplete="off"
                />
                <button className={styles.commentSend} type="submit" disabled={!commentText.trim() || postingComment}>
                  {postingComment ? <Loader2 size={15} className={styles.spin} /> : <Send size={15} />}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Slide ─────────────────────────────────────────────────────────────────────

function ReelSlide({ reel, isActive, userPaused, hlsUrl, muted, liked, reelStats, onLike, onComment, onMuteToggle, viewRecordedRef, milestoneRef, onViewCounted }) {
  const videoRef      = useRef(null)
  const hlsRef        = useRef(null)
  const pollRef       = useRef(null)
  const lastPosRef    = useRef(0)
  const lastDurRef    = useRef(0)
  const isActiveRef   = useRef(isActive)
  const userPausedRef = useRef(userPaused)
  const [progress,    setProgress]    = useState(0)
  const [heartPop,    setHeartPop]    = useState(false)
  const [slowMode,    setSlowMode]    = useState(false)
  const [loopCount,   setLoopCount]   = useState(0)
  const [hlsError,    setHlsError]    = useState(false)
  const slowPressRef = useRef(null)

  useEffect(() => { isActiveRef.current   = isActive   }, [isActive])
  useEffect(() => { userPausedRef.current = userPaused }, [userPaused])

  // Reset error state when a new URL arrives
  useEffect(() => { if (hlsUrl) setHlsError(false) }, [hlsUrl])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !hlsUrl) return
    setHlsError(false)

    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS
      v.src = hlsUrl
      if (isActiveRef.current && !userPausedRef.current) {
        v.play().catch(() => {})
      }
    } else if (Hls.isSupported()) {
      const h = new Hls({
        maxBufferLength:    20,
        startLevel:         0,
        enableWorker:       true,
        lowLatencyMode:     false,
      })
      h.loadSource(hlsUrl)
      h.attachMedia(v)
      h.on(Hls.Events.MANIFEST_PARSED, () => {
        if (isActiveRef.current && !userPausedRef.current) v.play().catch(() => {})
      })
      h.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error('[hls:fatal]', reel._id, data.type, data.details)
          setHlsError(true)
          h.destroy()
          hlsRef.current = null
        }
      })
      hlsRef.current = h
    } else {
      // Fallback: try direct src (some browsers handle HLS natively without the API)
      v.src = hlsUrl
      v.play().catch(() => {})
    }
    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
      if (v) { v.pause(); v.src = '' }
    }
  }, [hlsUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current; if (!v) return
    if (isActive && hlsUrl) {
      if (userPaused) v.pause()
      else v.play().catch(() => {})
    } else {
      v.pause(); v.currentTime = 0; setProgress(0); setLoopCount(0)
    }
  }, [isActive, hlsUrl, userPaused])

  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted }, [muted])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = slowMode ? 0.5 : 1
  }, [slowMode])

  useEffect(() => {
    const v = videoRef.current; if (!v || !isActive) return
    const t = () => { if (v.duration > 0) setProgress(v.currentTime / v.duration) }
    v.addEventListener('timeupdate', t)
    return () => v.removeEventListener('timeupdate', t)
  }, [isActive])

  useEffect(() => {
    if (!isActive || !hlsUrl) return
    const key = reel._id
    if (viewRecordedRef.current.has(key)) return
    pollRef.current = setInterval(() => {
      const pos = videoRef.current?.currentTime ?? 0
      if (pos < VIEW_THRESHOLD) return
      clearInterval(pollRef.current)
      if (viewRecordedRef.current.has(key)) return
      viewRecordedRef.current.add(key)
      recordReelView(reel._id, Math.floor(pos))
        .then((res) => { if (res?.stats) onViewCounted(res.stats) })
        .catch(() => {})
    }, 1000)
    return () => clearInterval(pollRef.current)
  }, [isActive, hlsUrl, reel._id])

  useEffect(() => {
    if (!isActive || !hlsUrl) return
    const id = reel._id, ms = milestoneRef.current
    const mkKey = (e) => `${id}:${e}`
    const send  = (eventType, extra = {}) => {
      const k = mkKey(eventType); if (ms.has(k)) return; ms.add(k)
      recordInteractionEvent({ itemType: 'reel', itemId: id, eventType, source: 'reels', ...extra }).catch(() => {})
    }
    send('play')
    const onTime = () => {
      const v = videoRef.current; if (!v) return
      const pos = v.currentTime, dur = v.duration || 0
      lastPosRef.current = pos; lastDurRef.current = dur
      if (pos >= 3)                    send('view_3s',    { positionSecs: pos, durationSecs: dur })
      if (dur > 0 && pos >= dur * 0.5) send('view_50',    { positionSecs: pos, durationSecs: dur, percent: pos / dur })
      if (dur > 0 && pos >= dur * 0.95)send('completion', { positionSecs: pos, durationSecs: dur, percent: 1 })
    }
    videoRef.current?.addEventListener('timeupdate', onTime)
    return () => {
      videoRef.current?.removeEventListener('timeupdate', onTime)
      const pos = lastPosRef.current, dur = lastDurRef.current
      if (!ms.has(mkKey('completion')) && pos >= 3 && (dur === 0 || pos < dur * 0.5))
        send('skip', { positionSecs: pos, durationSecs: dur })
    }
  }, [isActive, hlsUrl, reel._id])

  const handleShare = useCallback(async () => {
    const shareData = { title: reel.title || 'Dhara', url: window.location.href }
    if (navigator.share) {
      navigator.share(shareData).catch(() => {})
    } else {
      try { await navigator.clipboard.writeText(window.location.href) } catch {}
    }
  }, [reel.title])

  const creator    = reel.creatorId
  const studioName = creator?.creatorProfile?.studioName || creator?.displayName || 'Creator'
  const vc = reelStats.viewCount || 0, lc = reelStats.likeCount || 0, cc = reelStats.commentCount || 0

  return (
    <div
      className={`${styles.slide} ${isActive ? styles.on : ''}`}
      onTouchStart={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const rx = (e.touches[0].clientX - rect.left) / rect.width
        if (rx > 0.80) return
        slowPressRef.current = setTimeout(() => {
          if (navigator.vibrate) navigator.vibrate(20)
          setSlowMode(true)
        }, 600)
      }}
      onTouchEnd={() => {
        clearTimeout(slowPressRef.current)
        setSlowMode(false)
      }}
    >
      <video
        ref={videoRef}
        className={styles.vid}
        muted={muted}
        playsInline
        loop
        preload={isActive ? 'auto' : 'metadata'}
        poster={reel.thumbnailUrl || undefined}
        onEnded={() => setLoopCount(c => c + 1)}
      />

      <div className={styles.scrim} />

      {/* Loading spinner — shown while stream URL is being fetched */}
      {isActive && hlsUrl === undefined && !hlsError && (
        <div className={styles.slideLoader} aria-hidden="true">
          <Loader2 size={28} className={styles.spin} />
        </div>
      )}

      {/* Error state — stream URL returned null (404 / not ready) or HLS fatal error */}
      {isActive && (hlsUrl === null || hlsError) && (
        <div className={styles.slideUnavailable} aria-hidden="true">
          <Play size={22} strokeWidth={1.5} />
          <span>Video not available</span>
        </div>
      )}

      {userPaused && (
        <div className={styles.pauseOverlay} aria-hidden="true">
          <div className={styles.pauseIcon}>
            <Play size={30} fill="#fff" style={{ marginLeft: 3 }} />
          </div>
        </div>
      )}

      {slowMode && (
        <div className={styles.slowBadge} aria-hidden="true">½× Slow</div>
      )}

      {loopCount > 0 && (
        <div className={styles.loopBadge} aria-hidden="true">
          <span>↺</span> {loopCount > 1 ? `×${loopCount}` : '2nd watch'}
        </div>
      )}

      <div className={styles.bar}><div className={styles.fill} style={{ width: `${progress * 100}%` }} /></div>

      {/* ── Right sidebar: Volume · Like · Comment · Share · Views ── */}
      <div className={styles.actions}>
        <button className={styles.igAction} onClick={onMuteToggle} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <VolumeX size={25} strokeWidth={1.6} /> : <Volume2 size={25} strokeWidth={1.6} />}
        </button>
        <button
          className={`${styles.igAction} ${liked ? styles.igActionLiked : ''}`}
          onClick={() => {
            if (!liked) { setHeartPop(true); setTimeout(() => setHeartPop(false), 400) }
            onLike()
          }}
          aria-label={liked ? 'Unlike' : 'Like'}
        >
          <Heart
            size={28}
            fill={liked ? 'currentColor' : 'none'}
            strokeWidth={liked ? 0 : 1.6}
            className={heartPop ? styles.igHeartPop : ''}
          />
          <span>{fmt(lc)}</span>
        </button>

        <button className={styles.igAction} onClick={onComment} aria-label="Comments">
          <MessageCircle size={27} strokeWidth={1.6} />
          <span>{fmt(cc)}</span>
        </button>

        <button className={styles.igAction} onClick={handleShare} aria-label="Share">
          <Share2 size={25} strokeWidth={1.6} />
          <span>Share</span>
        </button>

        <div className={styles.igActionStat}>
          <Eye size={24} strokeWidth={1.6} />
          <span>{fmt(vc)}</span>
        </div>
      </div>

      {/* ── Bottom-left: creator + caption + hashtags ── */}
      <div className={styles.meta}>
        <div className={styles.creatorRow}>
          <div className={styles.avatarRing}>
            {creator?.photoURL
              ? <img src={creator.photoURL} alt={studioName} className={styles.avatar} />
              : <div className={styles.avatarFb}>{studioName[0]?.toUpperCase()}</div>
            }
          </div>
          <span className={styles.creatorName}>{studioName}</span>
          <VerifiedBadge size={15} />
        </div>
        {reel.title && <p className={styles.caption}>{reel.title}</p>}
        {reel.hashtags?.length > 0 && (
          <div className={styles.tags}>
            {reel.hashtags.slice(0, 4).map((t) => (
              <span key={t} className={styles.tag}><Hash size={10} />{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Comment row ───────────────────────────────────────────────────────────────

function CommentRow({ comment, currentUserId, onDelete }) {
  const u = comment.userId, own = String(u?._id || u?.id) === String(currentUserId), nm = u?.displayName || 'User'
  return (
    <div className={styles.cRow}>
      <div className={styles.cAvatar}>
        {u?.photoURL ? <img src={u.photoURL} alt={nm} /> : <span>{nm[0]?.toUpperCase()}</span>}
      </div>
      <div className={styles.cBody}>
        <div className={styles.cMeta}>
          <span className={styles.cName}>{nm}</span>
          <span className={styles.cTime}>{timeAgo(comment.createdAt)}</span>
        </div>
        <p className={styles.cText}>{comment.text}</p>
      </div>
      {own && <button className={styles.cDel} onClick={onDelete} aria-label="Delete"><Trash2 size={13} /></button>}
    </div>
  )
}

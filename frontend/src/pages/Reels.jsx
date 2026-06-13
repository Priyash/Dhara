import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Heart, MessageCircle, ArrowLeft, Volume2, VolumeX,
  ChevronUp, ChevronDown, Send, Loader2, Hash, X, Trash2,
  Play, Eye, TrendingUp, Zap,
} from 'lucide-react'
import Hls from 'hls.js'
import { useStore } from '../store/useStore'
import {
  fetchReels, fetchReelById, fetchReelStreamUrl, recordReelView, likeReel,
  fetchReelComments, postReelComment, deleteReelComment,
  recordInteractionEvent, getMe,
} from '../services/api'
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

  const [showTopics,   setShowTopics]   = useState(false)
  const [topicSearch,  setTopicSearch]  = useState('')

  // Derive hashtags with counts, sorted by frequency
  const hashtagCounts = reels.reduce((acc, r) => {
    ;(r.hashtags || []).forEach(t => { acc[t] = (acc[t] || 0) + 1 })
    return acc
  }, {})
  const allHashtags = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)

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

  const loadMore = () => {
    if (loadingMore || !hasMore) return
    const next = page + 1
    setPage(next)
    setLoadingMore(true)
    load(tab, hashtag, next)
  }

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

      {/* ── Topic filter bar ── */}
      {allHashtags.length > 0 && (
        <div className={styles.topicBar}>
          {/* Active filter chip — shown when a hashtag is selected */}
          {hashtag && (
            <button className={`${styles.chip} ${styles.chipActive}`} onClick={() => setHashtag('')}>
              <Hash size={10} />{hashtag} <X size={10} />
            </button>
          )}

          {/* Show top 5 most-used hashtags inline for quick access */}
          {!hashtag && allHashtags.slice(0, 5).map((t) => (
            <button key={t} className={styles.chip} onClick={() => setHashtag(t)}>
              <Hash size={10} />{t}
              <span className={styles.chipCount}>{hashtagCounts[t]}</span>
            </button>
          ))}

          {/* "Browse topics" popover for all hashtags */}
          {allHashtags.length > 5 && !hashtag && (
            <div className={styles.topicsMenu}>
              <button
                className={`${styles.chip} ${showTopics ? styles.chipActive : ''}`}
                onClick={() => { setShowTopics(v => !v); setTopicSearch('') }}
              >
                <Hash size={10} /> Browse topics
                {showTopics ? <X size={10} /> : <span className={styles.chipCount}>+{allHashtags.length - 5}</span>}
              </button>
              {showTopics && (
                <div className={styles.topicsDropdown}>
                  <div className={styles.topicsSearch}>
                    <input
                      className={styles.topicsInput}
                      value={topicSearch}
                      onChange={e => setTopicSearch(e.target.value.toLowerCase())}
                      placeholder="Search topics…"
                      autoFocus
                    />
                  </div>
                  <div className={styles.topicsList}>
                    {allHashtags
                      .filter(t => !topicSearch || t.includes(topicSearch))
                      .slice(0, 50)
                      .map(t => (
                        <button key={t} className={styles.topicsItem}
                          onClick={() => { setHashtag(t); setShowTopics(false) }}>
                          <Hash size={11} />
                          <span>{t}</span>
                          <span className={styles.topicsCount}>{hashtagCounts[t]}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
          {hasMore && (
            <div className={styles.loadMoreWrap}>
              <button className={styles.loadMoreBtn} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <><Loader2 size={14} className={styles.spin} /> Loading…</> : 'Load more'}
              </button>
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
  const studioName = creator?.creatorProfile?.studioName || creator?.displayName || 'Creator'

  return (
    <article className={styles.card} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div
        className={styles.cardPoster}
        style={reel.thumbnailUrl
          ? { backgroundImage: `url(${reel.thumbnailUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'linear-gradient(160deg,#1e1b4b 0%,#4c1d95 50%,#7c3aed 100%)' }
        }
      >
        <div className={styles.cardScrim} />

        {/* Play button — gate hint for signed-out users, plain play for signed-in */}
        <div className={styles.cardPlay}>
          {showGate
            ? <span className={styles.cardGateBadge}>Sign in to watch</span>
            : <Play size={18} fill="#fff" />
          }
        </div>

        {/* Engagement stats — always visible */}
        <div className={styles.cardStats}>
          <span><Eye size={10} />{fmt(reel.viewCount || 0)}</span>
          <span><Heart size={10} />{fmt(reel.likeCount || 0)}</span>
          <span><MessageCircle size={10} />{fmt(reel.commentCount || 0)}</span>
        </div>

        {/* Duration badge — top right */}
        {reel.durationSecs > 0 && (
          <span className={styles.cardDur}>{reel.durationSecs}s</span>
        )}
      </div>

      <div className={styles.cardMeta}>
        <div className={styles.cardCreatorRow}>
          {creator?.photoURL
            ? <img src={creator.photoURL} alt={studioName} className={styles.cardAvatar} />
            : <div className={styles.cardAvatarFb}>{studioName[0]?.toUpperCase()}</div>
          }
          <span className={styles.cardCreator}>{studioName}</span>
        </div>
        {reel.title && <p className={styles.cardTitle}>{reel.title}</p>}
        {reel.hashtags?.length > 0 && (
          <p className={styles.cardTags}>
            {reel.hashtags.slice(0, 2).map((t) => `#${t}`).join(' ')}
          </p>
        )}
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

  const viewRecordedRef = useRef(new Set())
  const milestoneRef    = useRef(new Set())
  const commentInputRef = useRef(null)

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
        if (!reel || streamUrls[reel._id]) return
        fetchReelStreamUrl(reel._id)
          .then(({ hlsUrl }) => setStreamUrls((p) => ({ ...p, [reel._id]: hlsUrl })))
          .catch(() => {})
      })
  }, [activeIndex, reels])

  const goTo = useCallback((idx) => {
    if (idx < 0 || idx >= reels.length) return
    setActiveIndex(idx)
    navigate(`/reels/${reels[idx]._id}`, { replace: true })
  }, [reels, navigate])

  useEffect(() => {
    if (commentsFor) return
    const h = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') goTo(activeIndex + 1)
      if (e.key === 'ArrowUp'   || e.key === 'k') goTo(activeIndex - 1)
      if (e.key === 'm') setMuted((m) => !m)
      if (e.key === 'Escape') setCommentsFor(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [activeIndex, goTo, commentsFor])

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
      <div className={styles.stage}>
        {reels.map((reel, i) => (
          <ReelSlide
            key={reel._id}
            reel={reel}
            isActive={i === activeIndex}
            hlsUrl={streamUrls[String(reel._id)] || null}
            muted={muted}
            liked={likedIds.has(String(reel._id))}
            reelStats={stats[String(reel._id)] || {}}
            onLike={() => handleLike(String(reel._id))}
            onComment={() => openComments(String(reel._id))}
            viewRecordedRef={viewRecordedRef}
            milestoneRef={milestoneRef}
            onViewCounted={(s) => setStats((p) => ({ ...p, [String(reel._id)]: { ...(p[String(reel._id)] || {}), ...s } }))}
          />
        ))}

        {/* Back to grid */}
        <button className={styles.btnFloat} style={{ top: 68, left: 16 }} onClick={() => navigate('/reels')} aria-label="Back to Reels">
          <ArrowLeft size={16} />
        </button>
        <button className={styles.btnFloat} style={{ top: 68, right: 60 }} onClick={() => setMuted((m) => !m)} aria-label="Mute">
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>

        {/* Nav */}
        <div className={styles.navCol}>
          <button className={styles.navArrow} onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}>
            <ChevronUp size={18} />
          </button>
          <span className={styles.navNum}>{activeIndex + 1}<em>/{reels.length}</em></span>
          <button className={styles.navArrow} onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === reels.length - 1}>
            <ChevronDown size={18} />
          </button>
        </div>
      </div>

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
  )
}

// ── Slide ─────────────────────────────────────────────────────────────────────

function ReelSlide({ reel, isActive, hlsUrl, muted, liked, reelStats, onLike, onComment, viewRecordedRef, milestoneRef, onViewCounted }) {
  const videoRef   = useRef(null)
  const hlsRef     = useRef(null)
  const pollRef    = useRef(null)
  const lastPosRef = useRef(0)
  const lastDurRef = useRef(0)
  const [progress,  setProgress]  = useState(0)
  const [heartPop,  setHeartPop]  = useState(false)   // one-shot animation trigger

  useEffect(() => {
    const v = videoRef.current; if (!v || !hlsUrl) return
    if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = hlsUrl }
    else if (Hls.isSupported()) {
      const h = new Hls({ maxBufferLength: 20, startLevel: 0 })
      h.loadSource(hlsUrl); h.attachMedia(v); hlsRef.current = h
    }
    return () => { hlsRef.current?.destroy(); hlsRef.current = null; v.src = '' }
  }, [hlsUrl])

  useEffect(() => {
    const v = videoRef.current; if (!v) return
    if (isActive && hlsUrl) { v.play().catch(() => {}) }
    else { v.pause(); v.currentTime = 0; setProgress(0) }
  }, [isActive, hlsUrl])

  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted }, [muted])

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

  const creator    = reel.creatorId
  const studioName = creator?.creatorProfile?.studioName || creator?.displayName || 'Creator'
  const vc = reelStats.viewCount || 0, lc = reelStats.likeCount || 0, cc = reelStats.commentCount || 0

  return (
    <div className={`${styles.slide} ${isActive ? styles.on : ''}`}>
      <video ref={videoRef} className={styles.vid} muted={muted} playsInline loop preload="metadata" poster={reel.thumbnailUrl || undefined} />

      {/* Bottom gradient — heavier at base for text legibility */}
      <div className={styles.scrim} />

      {/* Thin progress bar at the very bottom */}
      <div className={styles.bar}><div className={styles.fill} style={{ width: `${progress * 100}%` }} /></div>

      {/* ── Right sidebar actions (Instagram style: icon above, count below) ── */}
      <div className={styles.actions}>
        <button
          className={`${styles.igAction} ${liked ? styles.igActionLiked : ''}`}
          onClick={() => {
            // Fire pop only when going liked→true (not when unliking)
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
        </button>

        <button className={styles.igAction} onClick={onComment} aria-label="Comments">
          <MessageCircle size={27} strokeWidth={1.6} />
          <span>{fmt(cc)}</span>
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

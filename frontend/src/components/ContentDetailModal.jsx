import { useState } from 'react'
import { X, Play, Plus, Check, ThumbsUp, ThumbsDown, Crown, Globe, Star, Clapperboard, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { addToWatchlist, removeFromWatchlist, likeContent, dislikeContent } from '../services/api'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './ContentDetailModal.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

function formatReviewCount(n) {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export default function ContentDetailModal() {
  const navigate = useNavigate()
  const {
    selectedItem: item,
    setSelectedItem,
    openPaywall,
    openAuth,
    isLoggedIn,
    isSubscribed,
    user,
    refreshProfile,
  } = useStore()

  const [liked,        setLiked]        = useState(() => Boolean(user?.likedContent?.includes(item?.id)))
  const [disliked,     setDisliked]     = useState(() => Boolean(user?.dislikedContent?.includes(item?.id)))
  const [likeCount,    setLikeCount]    = useState(item?.likeCount    ?? 0)
  const [dislikeCount, setDislikeCount] = useState(item?.dislikeCount ?? 0)

  if (!item) return null

  const cleanTitle   = stripExtension(item.title)
  const inWatchlist  = user?.watchlist?.includes(item.id)
  const rating       = item.rating ?? 0
  const reviewCount  = formatReviewCount(item.reviewCount)
  const hasGenre     = item.genre?.length > 0
  const hasCast      = item.cast?.length > 0
  const hasDirector  = Boolean(item.director)
  const episodeCount = Array.isArray(item.episodes) ? item.episodes.length : 0

  // Prefer wide backdrop for the hero; fall back to poster
  const heroUrl = item.backdropUrl || item.posterUrl
  const heroTransformed = heroUrl
    ? cloudinaryTransform(heroUrl, 'w_1200,h_675,c_fill,g_auto,f_auto,q_auto')
    : null

  const handleWatch = () => {
    if (!isLoggedIn) { openAuth('signin'); return }
    if (item.isPremium && !isSubscribed) { openPaywall(); return }
    setSelectedItem(null)
    navigate(`/watch/${item.id}`)
  }

  const handleWatchlist = async () => {
    if (!isLoggedIn) { openAuth('signin'); return }
    try {
      if (inWatchlist) await removeFromWatchlist(item.id)
      else             await addToWatchlist(item.id)
      await refreshProfile()
    } catch { /* non-critical */ }
  }

  const handleLike = async () => {
    if (!isLoggedIn) { openAuth('signin'); return }
    // Optimistic update
    const prevLiked = liked; const prevDisliked = disliked
    setLiked(!prevLiked); setDisliked(false)
    setLikeCount((c) => prevLiked ? c - 1 : c + 1)
    if (prevDisliked) setDislikeCount((c) => c - 1)
    try {
      const r = await likeContent(item.id)
      setLiked(r.liked); setDisliked(r.disliked)
      setLikeCount(r.likeCount); setDislikeCount(r.dislikeCount)
    } catch {
      // revert
      setLiked(prevLiked); setDisliked(prevDisliked)
      setLikeCount((c) => prevLiked ? c + 1 : c - 1)
      if (prevDisliked) setDislikeCount((c) => c + 1)
    }
  }

  const handleDislike = async () => {
    if (!isLoggedIn) { openAuth('signin'); return }
    // Optimistic update
    const prevLiked = liked; const prevDisliked = disliked
    setDisliked(!prevDisliked); setLiked(false)
    setDislikeCount((c) => prevDisliked ? c - 1 : c + 1)
    if (prevLiked) setLikeCount((c) => c - 1)
    try {
      const r = await dislikeContent(item.id)
      setLiked(r.liked); setDisliked(r.disliked)
      setLikeCount(r.likeCount); setDislikeCount(r.dislikeCount)
    } catch {
      // revert
      setLiked(prevLiked); setDisliked(prevDisliked)
      setDislikeCount((c) => prevDisliked ? c + 1 : c - 1)
      if (prevLiked) setLikeCount((c) => c + 1)
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={cleanTitle}
      onClick={(e) => e.target === e.currentTarget && setSelectedItem(null)}
    >
      <div className={styles.modal}>

        {/* ── Hero ── */}
        <div
          className={styles.hero}
          style={heroTransformed
            ? { backgroundImage: `url(${heroTransformed})` }
            : { background: item.palette || '#1a1a22' }
          }
        >
          <div className={styles.heroScrim} />

          <button className={styles.closeBtn} onClick={() => setSelectedItem(null)} aria-label="Close">
            <X size={16} />
          </button>

          <div className={styles.heroFooter}>
            <div className={styles.badgeRow}>
              {item.isPremium && (
                <span className={styles.proBadge}><Crown size={10} /> PRO</span>
              )}
              {item.certification && (
                <span className={styles.certBadge}>{item.certification}</span>
              )}
              {item.contentLanguage && (
                <span className={styles.langBadge}><Globe size={10} /> {item.contentLanguage}</span>
              )}
            </div>
            <h2 className={styles.title}>{cleanTitle}</h2>
            {item.subtitle && <p className={styles.subtitle}>{item.subtitle}</p>}
          </div>
        </div>

        {/* ── Actions bar ── */}
        <div className={styles.actionsBar}>
          <div className={styles.actionsLeft}>
            <button className={styles.playBtn} onClick={handleWatch}>
              {item.isPremium && !isSubscribed
                ? <><Crown size={16} color="#000" /> Subscribe to Watch</>
                : !isLoggedIn
                ? <><Play size={16} color="#000" fill="#000" /> Sign In to Watch</>
                : <><Play size={16} color="#000" fill="#000" /> Play</>
              }
            </button>

            <button
              className={`${styles.circleBtn} ${inWatchlist ? styles.circleBtnSaved : ''}`}
              onClick={handleWatchlist}
              aria-label={inWatchlist ? 'Remove from My List' : 'Add to My List'}
              title={inWatchlist ? 'Remove from My List' : 'Add to My List'}
            >
              {inWatchlist ? <Check size={18} /> : <Plus size={18} />}
            </button>

            <button
              className={`${styles.circleBtn} ${liked ? styles.circleBtnLiked : ''}`}
              onClick={handleLike}
              aria-label="Like"
              title="I like this"
            >
              <ThumbsUp size={17} />
            </button>
            {likeCount > 0 && (
              <span className={styles.voteCount}>{formatReviewCount(likeCount)}</span>
            )}

            <button
              className={`${styles.circleBtn} ${disliked ? styles.circleBtnDisliked : ''}`}
              onClick={handleDislike}
              aria-label="Not for me"
              title="Not for me"
            >
              <ThumbsDown size={17} />
            </button>
            {dislikeCount > 0 && (
              <span className={styles.voteCount}>{formatReviewCount(dislikeCount)}</span>
            )}
          </div>

          <div className={styles.factsPill}>
            {item.releaseYear && <span className={styles.fact}>{item.releaseYear}</span>}
            <span className={styles.fact}>
              {episodeCount > 0 ? `${episodeCount} Episodes` : item.type}
            </span>
            {rating > 0 && (
              <span className={styles.factRating}>
                <Star size={11} fill="#f59e0b" color="#f59e0b" />
                {rating.toFixed(1)}
                {reviewCount && <> · {reviewCount}</>}
              </span>
            )}
          </div>
        </div>

        {/* ── Details — two-column ── */}
        <div className={styles.details}>
          <div className={styles.detailsMain}>
            {item.desc && <p className={styles.desc}>{item.desc}</p>}
            {hasGenre && (
              <div className={styles.genreRow}>
                {item.genre.map((g) => (
                  <span key={g} className={styles.genreChip}>{g}</span>
                ))}
              </div>
            )}
          </div>

          {(hasDirector || hasCast) && (
            <div className={styles.detailsSide}>
              {hasDirector && (
                <p className={styles.crewLine}>
                  <span className={styles.crewKey}><Clapperboard size={11} /> Director</span>
                  <span className={styles.crewVal}>{item.director}</span>
                </p>
              )}
              {hasCast && (
                <p className={styles.crewLine}>
                  <span className={styles.crewKey}><Users size={11} /> Cast</span>
                  <span className={styles.crewVal}>
                    {item.cast.slice(0, 4).join(', ')}
                    {item.cast.length > 4 ? ' and more' : ''}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

import { useState } from 'react'
import { X, Play, Plus, Check, ThumbsUp, ThumbsDown, Crown, Globe, Star } from 'lucide-react'
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
  const navigate   = useNavigate()
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
  const isSeries     = item.type === 'Series'
  const episodes     = Array.isArray(item.episodes) ? item.episodes : []
  const hasCast      = item.cast?.length > 0
  const hasDirector  = Boolean(item.director)
  const hasGenre     = item.genre?.length > 0

  const heroUrl = item.backdropUrl || item.posterUrl
  const heroTransformed = heroUrl
    ? cloudinaryTransform(heroUrl, 'w_1200,h_675,c_fill,g_auto,f_auto,q_auto')
    : null

  const handleWatch = (episodeBunnyId = null) => {
    if (!isLoggedIn) { openAuth('signin'); return }
    if (item.isPremium && !isSubscribed) { openPaywall(); return }
    setSelectedItem(null)
    // If a specific episode is clicked pass it via state; page handles it
    navigate(`/watch/${item.id}`, episodeBunnyId ? { state: { bunnyVideoId: episodeBunnyId } } : undefined)
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
    const prevLiked = liked; const prevDisliked = disliked
    setLiked(!prevLiked); setDisliked(false)
    setLikeCount((c) => prevLiked ? c - 1 : c + 1)
    if (prevDisliked) setDislikeCount((c) => c - 1)
    try {
      const r = await likeContent(item.id)
      setLiked(r.liked); setDisliked(r.disliked)
      setLikeCount(r.likeCount); setDislikeCount(r.dislikeCount)
    } catch {
      setLiked(prevLiked); setDisliked(prevDisliked)
      setLikeCount((c) => prevLiked ? c + 1 : c - 1)
      if (prevDisliked) setDislikeCount((c) => c + 1)
    }
  }

  const handleDislike = async () => {
    if (!isLoggedIn) { openAuth('signin'); return }
    const prevLiked = liked; const prevDisliked = disliked
    setDisliked(!prevDisliked); setLiked(false)
    setDislikeCount((c) => prevDisliked ? c - 1 : c + 1)
    if (prevLiked) setLikeCount((c) => c - 1)
    try {
      const r = await dislikeContent(item.id)
      setLiked(r.liked); setDisliked(r.disliked)
      setLikeCount(r.likeCount); setDislikeCount(r.dislikeCount)
    } catch {
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

        {/* ── Hero: title + buttons overlaid at bottom ── */}
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

          {/* Title + actions overlaid at the bottom of the hero */}
          <div className={styles.heroContent}>
            <div className={styles.heroBadges}>
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

            <div className={styles.actionsRow}>
              <button className={styles.playBtn} onClick={() => handleWatch()}>
                {item.isPremium && !isSubscribed
                  ? <><Crown size={15} color="#000" /> Subscribe</>
                  : !isLoggedIn
                  ? <><Play size={15} color="#000" fill="#000" /> Sign In</>
                  : <><Play size={15} color="#000" fill="#000" /> Play</>
                }
              </button>

              <button
                className={`${styles.circleBtn} ${inWatchlist ? styles.circleBtnSaved : ''}`}
                onClick={handleWatchlist}
                aria-label={inWatchlist ? 'Remove from My List' : 'Add to My List'}
                title={inWatchlist ? 'Remove from My List' : 'Add to My List'}
              >
                {inWatchlist ? <Check size={17} /> : <Plus size={17} />}
              </button>

              <button
                className={`${styles.circleBtn} ${liked ? styles.circleBtnLiked : ''}`}
                onClick={handleLike}
                aria-label="Like"
                title="I like this"
              >
                <ThumbsUp size={16} />
              </button>

              <button
                className={`${styles.circleBtn} ${disliked ? styles.circleBtnDisliked : ''}`}
                onClick={handleDislike}
                aria-label="Not for me"
                title="Not for me"
              >
                <ThumbsDown size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Info section — two column ── */}
        <div className={styles.info}>

          {/* Left: meta row → cert/warnings → description */}
          <div className={styles.infoLeft}>
            <div className={styles.metaRow}>
              {item.releaseYear && <span className={styles.metaMuted}>{item.releaseYear}</span>}
              {item.releaseYear && <span className={styles.metaDot}>·</span>}
              <span className={styles.metaMuted}>
                {isSeries && episodes.length > 0 ? `${episodes.length} Episodes` : item.type}
              </span>
              {rating > 0 && (
                <>
                  <span className={styles.metaDot}>·</span>
                  <span className={styles.metaRating}>
                    <Star size={11} fill="#f59e0b" color="#f59e0b" />
                    {rating.toFixed(1)}
                    {reviewCount && <span className={styles.metaReviewCount}> ({reviewCount})</span>}
                  </span>
                </>
              )}
            </div>

            {item.certification && (
              <div className={styles.certRow}>
                <span className={styles.certBox}>{item.certification}</span>
                {item.contentWarnings && (
                  <span className={styles.certWarnings}>{item.contentWarnings}</span>
                )}
              </div>
            )}

            {item.desc && <p className={styles.desc}>{item.desc}</p>}
          </div>

          {/* Right: cast, genres, mood tags */}
          {(hasCast || hasGenre || item.moodTags?.length > 0) && (
            <div className={styles.infoRight}>
              {hasCast && (
                <p className={styles.infoLine}>
                  <span className={styles.infoKey}>Cast:</span>
                  <span className={styles.infoVal}>
                    {item.cast.slice(0, 3).join(', ')}
                    {item.cast.length > 3 && <em className={styles.moreLink}>, more</em>}
                  </span>
                </p>
              )}
              {hasGenre && (
                <p className={styles.infoLine}>
                  <span className={styles.infoKey}>Genres:</span>
                  <span className={styles.infoVal}>{item.genre.join(', ')}</span>
                </p>
              )}
              {item.moodTags?.length > 0 && (
                <p className={styles.infoLine}>
                  <span className={styles.infoKey}>This {isSeries ? 'Show' : 'Film'} Is:</span>
                  <span className={styles.infoVal}>{item.moodTags.join(', ')}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Episodes — series only ── */}
        {isSeries && episodes.length > 0 && (
          <div className={styles.episodes}>
            <div className={styles.episodesHeader}>
              <h3 className={styles.episodesTitle}>Episodes</h3>
              <span className={styles.episodesType}>{item.subtitle || item.type}</span>
            </div>

            <div className={styles.episodeList}>
              {episodes.map((ep) => (
                <button
                  key={ep.number}
                  className={styles.episode}
                  onClick={() => handleWatch(ep.bunnyVideoId || null)}
                >
                  <span className={styles.epNumber}>{ep.number}</span>

                  <div className={styles.epThumb}>
                    <Play size={20} fill="rgba(255,255,255,0.9)" color="rgba(255,255,255,0.9)" />
                  </div>

                  <div className={styles.epMeta}>
                    <p className={styles.epTitle}>{stripExtension(ep.title)}</p>
                    {ep.duration && <p className={styles.epDuration}>{ep.duration}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── About section — movies only ── */}
        {!isSeries && (hasDirector || hasCast || hasGenre || item.certification) && (
          <div className={styles.about}>
            <h3 className={styles.aboutTitle}>
              About <strong>{cleanTitle}</strong>
            </h3>

            {hasDirector && (
              <p className={styles.aboutLine}>
                <span className={styles.aboutKey}>Director:</span>
                <span className={styles.aboutVal}>{item.director}</span>
              </p>
            )}

            {hasCast && (
              <p className={styles.aboutLine}>
                <span className={styles.aboutKey}>Cast:</span>
                <span className={styles.aboutVal}>{item.cast.join(', ')}</span>
              </p>
            )}

            {item.moodTags?.length > 0 && (
              <p className={styles.aboutLine}>
                <span className={styles.aboutKey}>This Film Is:</span>
                <span className={styles.aboutVal}>{item.moodTags.join(', ')}</span>
              </p>
            )}

            {item.certification && (
              <div className={styles.aboutLine}>
                <span className={styles.aboutKey}>Maturity Rating:</span>
                <div className={styles.certGroup}>
                  <span className={styles.certBox}>{item.certification}</span>
                  {item.contentWarnings && (
                    <span className={styles.aboutVal}>{item.contentWarnings}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

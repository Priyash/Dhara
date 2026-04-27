import { X, Play, Plus, Check, Star, Crown, Globe, Clapperboard, Users, BadgeCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { addToWatchlist, removeFromWatchlist } from '../services/api'
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

  if (!item) return null

  const cleanTitle   = stripExtension(item.title)
  const inWatchlist  = user?.watchlist?.includes(item.id)
  const rating       = item.rating ?? 0
  const fullStars    = Math.floor(rating)
  const halfStar     = rating - fullStars >= 0.5
  const reviewCount  = formatReviewCount(item.reviewCount)
  const hasGenre     = item.genre?.length > 0
  const hasCast      = item.cast?.length > 0
  const hasDirector  = Boolean(item.director)
  const episodeCount = Array.isArray(item.episodes) ? item.episodes.length : 0

  const headerBg = item.posterUrl
    ? { backgroundImage: `url(${item.posterUrl})` }
    : { background: item.palette }

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

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={cleanTitle}
      onClick={(e) => e.target === e.currentTarget && setSelectedItem(null)}
    >
      <div className={styles.modal}>

        {/* ── Header ── */}
        <div className={styles.header} style={headerBg}>
          <div className={styles.headerScrim} />

          <button className={styles.closeBtn} onClick={() => setSelectedItem(null)} aria-label="Close">
            <X size={15} />
          </button>

          <div className={styles.headerContent}>
            {/* Badge row */}
            <div className={styles.badgeRow}>
              {item.isPremium && (
                <span className={styles.proBadge}>
                  <Crown size={10} color="#fff" /> PRO
                </span>
              )}
              {item.certification && (
                <span className={styles.certBadge}>{item.certification}</span>
              )}
              {item.contentLanguage && (
                <span className={styles.langBadge}>
                  <Globe size={10} /> {item.contentLanguage}
                </span>
              )}
            </div>

            <h2 className={styles.title}>{cleanTitle}</h2>

            {/* Quick facts */}
            <div className={styles.facts}>
              {item.releaseYear && <span className={styles.fact}>{item.releaseYear}</span>}
              <span className={styles.fact}>{episodeCount > 0 ? `${episodeCount} Episodes` : item.type}</span>
              {rating > 0 && (
                <span className={styles.factRating}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      size={11}
                      color="#f59e0b"
                      fill={
                        i < fullStars ? '#f59e0b'
                        : (!fullStars && halfStar && i === fullStars) || (halfStar && i === fullStars)
                          ? 'rgba(245,158,11,0.5)'
                          : 'rgba(245,158,11,0.15)'
                      }
                    />
                  ))}
                  <span>{rating.toFixed(1)}{reviewCount && ` · ${reviewCount} reviews`}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={styles.body}>

          {/* Synopsis */}
          {item.desc && <p className={styles.desc}>{item.desc}</p>}

          {/* Genre chips */}
          {hasGenre && (
            <div className={styles.section}>
              <div className={styles.genreRow}>
                {item.genre.map((g) => (
                  <span key={g} className={styles.genreChip}>{g}</span>
                ))}
              </div>
            </div>
          )}

          {/* Crew */}
          {(hasDirector || hasCast) && (
            <div className={styles.crew}>
              {hasDirector && (
                <div className={styles.crewRow}>
                  <span className={styles.crewLabel}>
                    <Clapperboard size={12} /> Director
                  </span>
                  <span className={styles.crewValue}>{item.director}</span>
                </div>
              )}
              {hasCast && (
                <div className={styles.crewRow}>
                  <span className={styles.crewLabel}>
                    <Users size={12} /> Cast
                  </span>
                  <div className={styles.castChips}>
                    {item.cast.map((name) => (
                      <span key={name} className={styles.castChip}>{name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className={styles.actions}>
            <button className={styles.watchBtn} onClick={handleWatch}>
              {item.isPremium && !isSubscribed
                ? <><Crown size={15} color="#000" /> Subscribe to Watch</>
                : !isLoggedIn
                ? <><Play size={15} color="#000" fill="#000" /> Sign In to Watch</>
                : <><Play size={15} color="#000" fill="#000" /> Watch Now</>
              }
            </button>

            <button
              className={`${styles.iconBtn} ${inWatchlist ? styles.iconBtnActive : ''}`}
              onClick={handleWatchlist}
              aria-label={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
              title={inWatchlist ? 'In your watchlist' : 'Add to watchlist'}
            >
              {inWatchlist ? <Check size={18} /> : <Plus size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, List, Crown, Lock, MailCheck, Star, Clapperboard, Users, Globe, Play, SkipForward, VideoOff, RotateCcw } from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import PosterCard from '../components/PosterCard'
import { fetchContentById, fetchStreamUrl, saveWatchProgress, recordView, fetchContent, rateContent } from '../services/api'
import { useStore } from '../store/useStore'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './Watch.module.css'

function formatTime(secs) {
  if (!secs || !isFinite(secs)) return ''
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`
}

function StarRating({ contentId, initialScore, communityRating, communityRatingCount }) {
  const { isLoggedIn } = useStore()
  const [hovered, setHovered] = useState(0)
  const [selected, setSelected] = useState(initialScore || 0)
  const [submitted, setSubmitted] = useState(Boolean(initialScore))
  const [community, setCommunity] = useState({ rating: communityRating, count: communityRatingCount })

  const handleRate = async (score) => {
    if (!isLoggedIn) return
    setSelected(score)
    setSubmitted(true)
    try {
      const res = await rateContent(contentId, score)
      setCommunity({ rating: res.communityRating, count: res.communityRatingCount })
    } catch {}
  }

  const display = hovered || selected
  return (
    <div className={styles.starRating}>
      <div className={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={styles.starBtn}
            onMouseEnter={() => !submitted && setHovered(n)}
            onMouseLeave={() => !submitted && setHovered(0)}
            onClick={() => handleRate(n)}
            aria-label={`Rate ${n} out of 5`}
          >
            <Star
              size={18}
              fill={n <= display ? '#f59e0b' : 'none'}
              color={n <= display ? '#f59e0b' : 'rgba(255,255,255,0.25)'}
              strokeWidth={1.5}
            />
          </button>
        ))}
      </div>
      {community.count > 0 && (
        <span className={styles.starMeta}>
          {community.rating.toFixed(1)} · {community.count.toLocaleString()} {community.count === 1 ? 'rating' : 'ratings'}
        </span>
      )}
    </div>
  )
}

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function Watch() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { isLoggedIn, isSubscribed, user, openPaywall, openVerifyEmailGate, openAuth, openItem, authLoading } = useStore()

  const [content,        setContent]       = useState(null)
  const [hlsUrl,         setHlsUrl]        = useState(null)
  const [activeEp,       setActiveEp]      = useState(0)
  const [showList,       setShowList]      = useState(false)
  const [loading,        setLoading]       = useState(true)
  const [contentError,   setContentError]  = useState(null)
  const [streamError,    setStreamError]   = useState(null)
  const [related,        setRelated]       = useState([])
  const [resumePos,      setResumePos]     = useState(null)
  const resumeTimerRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    setRelated([])
    setStreamError(null)
    setResumePos(null)
    fetchContentById(id)
      .then((c) => {
        setContent(c)
        const genre = c.genre?.[0]
        fetchContent({ type: c.type, ...(genre ? { genre } : {}), sort: 'rating', page: 1, limit: 7 })
          .then((res) => {
            const items = Array.isArray(res) ? res : (res.items ?? [])
            setRelated(items.filter((r) => r._id !== id && r.id !== id).slice(0, 6))
          })
          .catch(() => {})
      })
      .catch(() => setContentError('This title could not be found.'))
      .finally(() => setLoading(false))
  }, [id])

  // Pre-populate localStorage from server-side watch progress for cross-device resume
  useEffect(() => {
    if (!content || !user?.watchProgress) return
    const epNum = content.episodes?.length > 0
      ? (content.episodes[activeEp]?.number ?? null)
      : null
    const saved = user.watchProgress.find(
      (p) => String(p.contentId) === id && (p.episodeNumber ?? null) === epNum
    )
    if (!saved || saved.positionSecs < 30) return

    const key   = `dhara_progress_${id}`
    const local = parseFloat(localStorage.getItem(key) || '0')
    if (saved.positionSecs > local) {
      localStorage.setItem(key, String(saved.positionSecs))
      if (saved.durationSecs) localStorage.setItem(`${key}_dur`, String(saved.durationSecs))
    }
    setResumePos(saved.positionSecs)
  }, [content, user, id, activeEp])

  useEffect(() => {
    if (!content || !isLoggedIn) return
    if (!user?.emailVerified) return
    if (content.isPremium && !isSubscribed) return

    const epNumber = content.episodes?.length > 0
      ? (content.episodes[activeEp]?.number ?? null)
      : null

    setHlsUrl(null)
    setStreamError(null)
    fetchStreamUrl(id, epNumber)
      .then(({ hlsUrl }) => { setHlsUrl(hlsUrl) })
      .catch(() => setStreamError('Video temporarily unavailable · We\'re working on it'))
  }, [content, id, activeEp, isLoggedIn, isSubscribed, user?.emailVerified])

  // Record a view (and episode view) each time the active stream changes
  useEffect(() => {
    if (!hlsUrl) return
    const epNumber = content?.episodes?.length > 0
      ? (content.episodes[activeEp]?.number ?? null)
      : null
    recordView(id, epNumber).catch(() => {})
  }, [hlsUrl, id])  // intentionally omit activeEp — hlsUrl change is the signal

  // Persist watch progress to backend every 30 s while playing
  useEffect(() => {
    if (!hlsUrl || !isLoggedIn) return
    const STORAGE_KEY = `dhara_progress_${id}`

    const tick = () => {
      const pos = parseFloat(localStorage.getItem(STORAGE_KEY) || '0')
      const dur = parseFloat(localStorage.getItem(`${STORAGE_KEY}_dur`) || '0')
      if (pos < 10) return
      // Don't save if within last 45 s — treat as finished, remove from continue-watching
      if (dur > 0 && pos > dur - 45) return
      saveWatchProgress({
        contentId:     id,
        episodeNumber: content?.episodes?.length > 0 ? (content.episodes[activeEp]?.number ?? null) : null,
        positionSecs:  Math.floor(pos),
        durationSecs:  Math.floor(dur),
      }).catch(() => {})
    }

    const timer = setInterval(tick, 30_000)
    return () => { clearInterval(timer); tick() }  // flush final position on navigate-away
  }, [hlsUrl, isLoggedIn, id, activeEp, content])

  // Auto-dismiss resume prompt after 8 s
  useEffect(() => {
    if (!resumePos) return
    resumeTimerRef.current = setTimeout(() => setResumePos(null), 8000)
    return () => clearTimeout(resumeTimerRef.current)
  }, [resumePos])

  const dismissResume = useCallback((startOver) => {
    clearTimeout(resumeTimerRef.current)
    if (startOver) {
      const key = `dhara_progress_${id}`
      localStorage.removeItem(key)
      localStorage.removeItem(`${key}_dur`)
    }
    setResumePos(null)
  }, [id])

  if (loading || authLoading) return <div className={styles.state}>Loading…</div>
  if (contentError)           return <div className={styles.state}>{contentError}</div>

  const cleanTitle    = stripExtension(content.title)
  const episodes      = content?.episodes || []
  const activeEpisode = episodes[activeEp]
  const playerTitle   = activeEpisode ? `${cleanTitle} — ${activeEpisode.title}` : cleanTitle
  const hasNextEp     = episodes.length > 0 && activeEp < episodes.length - 1

  const hasGenre    = content.genre?.length > 0
  const hasCast     = content.cast?.length > 0
  const hasDirector = Boolean(content.director)
  const hasRating   = content.rating > 0
  const hasMeta     = hasGenre || hasCast || hasDirector || hasRating || content.releaseYear || content.desc

  // Build backdrop URL for cinematic gate
  const backdropRaw = content.backdropUrl || content.posterUrl || null
  const backdropUrl = backdropRaw
    ? cloudinaryTransform(backdropRaw, 'w_1920,h_1080,c_fill,g_auto,f_auto,q_auto:low')
    : null

  // Determine which gate state we're in
  const gateState = !isLoggedIn
    ? 'unauthenticated'
    : !user?.emailVerified
    ? 'unverified'
    : content.isPremium && !isSubscribed
    ? 'premium'
    : null

  // ── Cinematic gate — shown for all access-blocked states ──────────────────
  if (gateState) {
    return (
      <div
        className={styles.cinematicGate}
        style={backdropUrl ? { '--backdrop': `url(${backdropUrl})` } : {}}
      >
        <div className={styles.gateScrim} />

        <button className={styles.gateBackBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> Back
        </button>

        <div className={styles.gateCentered}>
          {/* Movie context — teases what they're about to watch */}
          <div className={styles.gateMovieInfo}>
            {hasGenre && (
              <div className={styles.gateGenres}>
                {content.genre.slice(0, 3).map((g) => (
                  <span key={g} className={styles.gateGenreChip}>{g}</span>
                ))}
              </div>
            )}
            <h1 className={styles.gateMovieTitle}>{cleanTitle}</h1>
            <div className={styles.gateMovieMeta}>
              {content.releaseYear && <span>{content.releaseYear}</span>}
              {content.type        && <><span className={styles.gateMetaDot}>·</span><span>{content.type}</span></>}
              {hasRating           && <><span className={styles.gateMetaDot}>·</span><span className={styles.gateRating}><Star size={11} fill="#f59e0b" color="#f59e0b" /> {content.rating.toFixed(1)}</span></>}
            </div>
          </div>

          {/* The actual gate CTA panel */}
          <div className={styles.gatePanel}>
            {gateState === 'unauthenticated' && (
              <>
                <div className={styles.gatePanelIcon}><Lock size={22} /></div>
                <h2 className={styles.gatePanelTitle}>Sign in to watch</h2>
                <p className={styles.gatePanelDesc}>
                  Join Dhara and enjoy unlimited Bengali cinema, series & documentaries.
                </p>
                <button className={styles.gatePanelBtn} onClick={() => openAuth('signin')}>
                  <Play size={14} fill="currentColor" /> Sign In to Continue
                </button>
                <p className={styles.gatePanelFine}>Free trial available · No credit card required</p>
              </>
            )}

            {gateState === 'unverified' && (
              <>
                <div className={styles.gatePanelIcon} style={{ color: '#fbbf24' }}><MailCheck size={22} /></div>
                <h2 className={styles.gatePanelTitle}>Verify your email</h2>
                <p className={styles.gatePanelDesc}>
                  Check your inbox and verify your email address to start watching.
                </p>
                <div className={styles.gatePanelActions}>
                  <button className={styles.gatePanelBtn} onClick={() => openVerifyEmailGate('watch')}>
                    Verify Email
                  </button>
                  <button className={styles.gatePanelBtnGhost} onClick={() => navigate('/profile')}>
                    Open Profile
                  </button>
                </div>
              </>
            )}

            {gateState === 'premium' && (
              <>
                <div className={styles.gatePanelIcon} style={{ color: '#f59e0b' }}><Crown size={22} /></div>
                <h2 className={styles.gatePanelTitle}>Premium content</h2>
                <p className={styles.gatePanelDesc}>
                  Subscribe to Dhara Pro to unlock this title and all premium content.
                </p>
                <button className={styles.gatePanelBtn} onClick={openPaywall}>
                  <Crown size={14} /> Subscribe — from ₹99/mo
                </button>
                <p className={styles.gatePanelFine}>Cancel anytime · No hidden charges</p>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </div>

      <div className={styles.playerWrap}>
        {streamError ? (
          <div className={styles.streamUnavailable}>
            <VideoOff size={32} className={styles.streamUnavailableIcon} />
            <p className={styles.streamUnavailableTitle}>Video temporarily unavailable</p>
            <p className={styles.streamUnavailableDesc}>{streamError}</p>
            <button
              className={styles.streamRetryBtn}
              onClick={() => {
                setStreamError(null)
                const epNumber = content.episodes?.length > 0
                  ? (content.episodes[activeEp]?.number ?? null) : null
                setHlsUrl(null)
                fetchStreamUrl(id, epNumber)
                  .then(({ hlsUrl }) => setHlsUrl(hlsUrl))
                  .catch(() => setStreamError('Video temporarily unavailable · We\'re working on it'))
              }}
            >
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <VideoPlayer
              src={hlsUrl}
              title={playerTitle}
              poster={content.posterUrl || null}
              storageKey={id}
            />
            {resumePos && (
              <div className={styles.resumePrompt}>
                <span className={styles.resumeText}>
                  Resume from <strong>{formatTime(resumePos)}</strong>?
                </span>
                <button className={styles.resumeBtn} onClick={() => dismissResume(false)}>
                  Continue
                </button>
                <button className={styles.resumeBtnGhost} onClick={() => dismissResume(true)}>
                  Start over
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.below}>
        {hasMeta && (
          <div className={styles.metaPanel}>
            {/* Left: title block + synopsis */}
            <div className={styles.metaLeft}>
              <div className={styles.metaHeader}>
                <h1 className={styles.metaTitle}>{cleanTitle}</h1>
                {content.subtitle && (
                  <p className={styles.metaSubtitle}>{content.subtitle}</p>
                )}
                {content.isPremium && (
                  <span className={styles.proBadge}>
                    <Crown size={10} color="#fff" /> PRO
                  </span>
                )}
              </div>

              {/* Quick facts row */}
              <div className={styles.quickFacts}>
                {content.releaseYear && (
                  <span className={styles.fact}>{content.releaseYear}</span>
                )}
                {content.type && (
                  <span className={styles.fact}>{content.type}</span>
                )}
                {content.contentLanguage && (
                  <span className={styles.factLang}>
                    <Globe size={11} />
                    {content.contentLanguage}
                  </span>
                )}
                {content.certification && (
                  <span className={styles.factCert}>{content.certification}</span>
                )}
                {hasRating && (
                  <span className={styles.factRating}>
                    <Star size={11} fill="#f59e0b" color="#f59e0b" />
                    {content.rating.toFixed(1)}
                  </span>
                )}
              </div>

              {hasGenre && (
                <div className={styles.genreRow}>
                  {content.genre.map((g) => (
                    <span key={g} className={styles.genreChip}>{g}</span>
                  ))}
                </div>
              )}

              {content.desc && (
                <p className={styles.synopsis}>{content.desc}</p>
              )}

              {isLoggedIn && (
                <StarRating
                  contentId={id}
                  initialScore={null}
                  communityRating={content.communityRating ?? 0}
                  communityRatingCount={content.communityRatingCount ?? 0}
                />
              )}
            </div>

            {/* Right: crew + cast */}
            {(hasDirector || hasCast) && (
              <div className={styles.metaRight}>
                {hasDirector && (
                  <div className={styles.crewBlock}>
                    <div className={styles.crewLabel}>
                      <Clapperboard size={12} />
                      Director
                    </div>
                    <p className={styles.crewValue}>{content.director}</p>
                  </div>
                )}
                {hasCast && (
                  <div className={styles.crewBlock}>
                    <div className={styles.crewLabel}>
                      <Users size={12} />
                      Cast
                    </div>
                    <div className={styles.castRow}>
                      {content.cast.map((name) => (
                        <span key={name} className={styles.castChip}>{name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className={styles.info}>
          {hasNextEp && (
            <button
              className={styles.nextEpBtn}
              onClick={() => { setActiveEp(activeEp + 1); setShowList(false) }}
            >
              <SkipForward size={15} />
              Next: Ep {episodes[activeEp + 1].number}
              {episodes[activeEp + 1].title ? ` · ${episodes[activeEp + 1].title}` : ''}
            </button>
          )}
          {episodes.length > 0 && (
            <button className={styles.listToggle} onClick={() => setShowList((s) => !s)}>
              <List size={16} />
              {showList ? 'Hide Episodes' : 'All Episodes'}
            </button>
          )}
        </div>

        {showList && episodes.length > 0 && (
          <div className={styles.episodes}>
            <h2 className={styles.episodesTitle}>Episodes</h2>
            <div className={styles.episodeGrid}>
              {episodes.map((ep, i) => (
                <button
                  key={ep._key || ep.number}
                  className={`${styles.episode} ${activeEp === i ? styles.episodeActive : ''}`}
                  onClick={() => setActiveEp(i)}
                >
                  <div className={styles.epNumber}>{ep.number}</div>
                  <div className={styles.epInfo}>
                    <span className={styles.epTitle}>{ep.title}</span>
                    <span className={styles.epDur}>{ep.duration}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      {/* ── Related content ── */}
      {related.length > 0 && (
        <div className={styles.related}>
          <h2 className={styles.relatedTitle}>More Like This</h2>
          <div className={styles.relatedGrid}>
            {related.map((item) => (
              <PosterCard
                key={item._id || item.id}
                item={item}
                size="normal"
                isSubscribed={isSubscribed}
                onClick={(clicked) => {
                  if (clicked.isPremium && !isSubscribed) { openItem(clicked); return }
                  navigate(`/watch/${clicked._id || clicked.id}`)
                }}
              />
            ))}
          </div>
        </div>
      )}

      </div>
    </div>
  )
}

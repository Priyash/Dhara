import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, List, Crown, Lock, MailCheck, Star, Play, SkipForward, VideoOff, RotateCcw } from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import PosterCard from '../components/PosterCard'
import { fetchContentById, fetchStreamUrl, saveWatchProgress, recordView, fetchContent, rateContent, recordInteractionEvent, sendStreamHeartbeat, endStreamSession } from '../services/api'
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


function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function Watch() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { isLoggedIn, isSubscribed, user, openPaywall, openVerifyEmailGate, openAuth, openItem, authLoading,
          subscriptionStatus, subscriptionPlan, trialEndsAt, graceEndsAt } = useStore()

  const [content,        setContent]       = useState(null)
  const [hlsUrl,           setHlsUrl]          = useState(null)
  const [sessionId,        setSessionId]        = useState(null)
  const [maxQualityHeight, setMaxQualityHeight] = useState(null)
  const [activeSeason,     setActiveSeason]     = useState(0)  // index into content.seasons[]
  const [activeEp,         setActiveEp]         = useState(0)  // index into current season's episodes[]
  const [streamTier,       setStreamTier]       = useState(null)
  const [showList,         setShowList]         = useState(false)
  const [loading,          setLoading]          = useState(true)
  const [contentError,     setContentError]     = useState(null)
  const [streamError,      setStreamError]      = useState(null)
  const [related,        setRelated]       = useState([])
  const [resumePos,      setResumePos]     = useState(null)
  const [theaterMode,    setTheaterMode]   = useState(false)
  const [showEndCard,    setShowEndCard]   = useState(false)
  // Tracks which content+episode sessions have already had their view recorded
  // this mount. Key: `${id}-${episodeIndex}`. Prevents double-counting on re-renders.
  const viewRecordedRef = useRef(new Set())
  const milestoneRef = useRef(new Set())

  // ── Sticky player lock ────────────────────────────────────────────────────────
  // When playing starts, playerWrap becomes sticky so it stays visible while
  // the user reads the description / episode list below it.
  // Scrolling (wheel / touch) or resizing releases the lock permanently until
  // the next video load.
  const playerWrapRef      = useRef(null)
  const stickyReleasedRef  = useRef(false)
  const [playerPlaying,    setPlayerPlaying] = useState(false)

  // Reset sticky lock when a new video loads (hlsUrl changes) or user switches season/ep
  useEffect(() => {
    stickyReleasedRef.current = false
    setPlayerPlaying(false)
    setShowEndCard(false)
  }, [hlsUrl])

  // Apply / remove sticky on play state change
  useEffect(() => {
    const el = playerWrapRef.current
    if (!el) return
    if (playerPlaying && !stickyReleasedRef.current) {
      el.classList.add(styles.playerWrapLocked)
      // Scroll the player into view if it's not already fully visible
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } else {
      el.classList.remove(styles.playerWrapLocked)
    }
  }, [playerPlaying])

  // Release lock on user-initiated scroll or resize
  useEffect(() => {
    if (!playerPlaying) return
    const release = () => {
      if (stickyReleasedRef.current) return
      stickyReleasedRef.current = true
      playerWrapRef.current?.classList.remove(styles.playerWrapLocked)
    }
    window.addEventListener('wheel',     release, { passive: true })
    window.addEventListener('touchmove', release, { passive: true })
    window.addEventListener('resize',    release)
    return () => {
      window.removeEventListener('wheel',     release)
      window.removeEventListener('touchmove', release)
      window.removeEventListener('resize',    release)
    }
  }, [playerPlaying])

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
    const seasons    = content.seasons || []
    const curSeason  = seasons[activeSeason] ?? null
    const epNum      = curSeason?.episodes?.length > 0 ? (curSeason.episodes[activeEp]?.number ?? null) : null
    const seNum      = curSeason?.number ?? null
    const saved = user.watchProgress.find(
      (p) => String(p.contentId) === id && (p.seasonNumber ?? null) === seNum && (p.episodeNumber ?? null) === epNum
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

    const seasons       = content.seasons || []
    const curSeason     = seasons[activeSeason] ?? null
    const episodes      = curSeason?.episodes || []
    const isFirstEpFree = content.isPremium && seasons.length > 0 && activeSeason === 0 && activeEp === 0
    if (content.isPremium && !isSubscribed && !isFirstEpFree) return

    const seNumber = curSeason?.number ?? null
    const epNumber = episodes.length > 0 ? (episodes[activeEp]?.number ?? null) : null

    setHlsUrl(null)
    setSessionId(null)
    setStreamError(null)
    fetchStreamUrl(id, epNumber, seNumber)
      .then(({ hlsUrl, sessionId: sid, maxQualityHeight: mqh, tier: t }) => {
        setHlsUrl(hlsUrl)
        setSessionId(sid ?? null)
        setMaxQualityHeight(mqh ?? null)
        setStreamTier(t ?? null)
      })
      .catch((err) => {
        if (err.message?.includes('TOO_MANY_STREAMS') || err.message?.includes('concurrent stream')) {
          setStreamError(err.message)
        } else {
          setStreamError('Video temporarily unavailable · We\'re working on it')
        }
      })
  }, [content, id, activeSeason, activeEp, isLoggedIn, isSubscribed, user?.emailVerified])

  // Heartbeat: keeps the stream session alive while the player is open.
  // Cleans up the session immediately when the component unmounts or the stream changes.
  useEffect(() => {
    if (!sessionId) return
    const interval = setInterval(() => {
      sendStreamHeartbeat(sessionId).catch(() => {})
    }, 30_000)
    return () => {
      clearInterval(interval)
      endStreamSession(sessionId).catch(() => {})
    }
  }, [sessionId])

  // Recommendation events: play, 3-second view, 50% view, completion, skip.
  useEffect(() => {
    if (!hlsUrl || !isLoggedIn) return

    const STORAGE_KEY = `dhara_progress_${id}`
    const sessionKey = `${id}-${activeSeason}-${activeEp}`
    const milestones = milestoneRef.current
    const eventKey = (name) => `${sessionKey}:${name}`
    const seasons   = content?.seasons || []
    const curSeason = seasons[activeSeason] ?? null
    const seNumber  = curSeason?.number ?? null
    const epNumber  = curSeason?.episodes?.length > 0 ? (curSeason.episodes[activeEp]?.number ?? null) : null

    const send = (eventType, extra = {}) => {
      const key = eventKey(eventType)
      if (milestones.has(key)) return
      milestones.add(key)
      recordInteractionEvent({
        itemId: id,
        eventType,
        source: 'watch',
        seasonNumber:  seNumber,
        episodeNumber: epNumber,
        ...extra,
      }).catch(() => {})
    }

    send('play')

    const readProgress = () => {
      const positionSecs = parseFloat(localStorage.getItem(STORAGE_KEY) || '0')
      const durationSecs = parseFloat(localStorage.getItem(`${STORAGE_KEY}_dur`) || '0')
      const percent = durationSecs > 0 ? Math.min(1, positionSecs / durationSecs) : 0
      return { positionSecs, durationSecs, percent }
    }

    const poll = setInterval(() => {
      const progress = readProgress()
      if (progress.positionSecs >= 3) send('view_3s', progress)
      if (progress.durationSecs > 0 && progress.percent >= 0.5) send('view_50', progress)
      if (progress.durationSecs > 0 && (progress.percent >= 0.95 || progress.positionSecs >= progress.durationSecs - 15)) {
        send('completion', progress)
      }
    }, 3_000)

    return () => {
      clearInterval(poll)
      const progress = readProgress()
      const completed = milestones.has(eventKey('completion'))
      const earlyExit = progress.positionSecs >= 3 && (
        progress.durationSecs > 0 ? progress.percent < 0.5 : progress.positionSecs < 30
      )
      if (!completed && earlyExit) send('skip', progress)
    }
  }, [hlsUrl, isLoggedIn, id, activeSeason, activeEp, content])

  // Record a view only after the user has genuinely watched 30 seconds.
  // Polls localStorage position (written by the player) every 5 s so we don't
  // need to touch VideoPlayer internals. The Set prevents double-counting
  // if the effect re-runs while the same session is active.
  useEffect(() => {
    if (!hlsUrl || !isLoggedIn) return

    const STORAGE_KEY = `dhara_progress_${id}`
    const sessionKey  = `${id}-${activeSeason}-${activeEp}`
    const VIEW_THRESHOLD_SECS = 30

    if (viewRecordedRef.current.has(sessionKey)) return

    const poll = setInterval(() => {
      const pos = parseFloat(localStorage.getItem(STORAGE_KEY) || '0')
      if (pos < VIEW_THRESHOLD_SECS) return

      clearInterval(poll)
      if (viewRecordedRef.current.has(sessionKey)) return
      viewRecordedRef.current.add(sessionKey)

      const seasons   = content?.seasons || []
      const curSeason = seasons[activeSeason] ?? null
      const seNumber  = curSeason?.number ?? null
      const epNumber  = curSeason?.episodes?.length > 0 ? (curSeason.episodes[activeEp]?.number ?? null) : null
      recordView(id, epNumber, Math.floor(pos), seNumber).catch(() => {})
    }, 5_000)

    return () => clearInterval(poll)
  }, [hlsUrl, isLoggedIn, id, activeSeason, activeEp, content])

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
      const seasons   = content?.seasons || []
      const curSeason = seasons[activeSeason] ?? null
      saveWatchProgress({
        contentId:     id,
        seasonNumber:  curSeason?.number ?? null,
        episodeNumber: curSeason?.episodes?.length > 0 ? (curSeason.episodes[activeEp]?.number ?? null) : null,
        positionSecs:  Math.floor(pos),
        durationSecs:  Math.floor(dur),
      }).catch(() => {})
    }

    const timer = setInterval(tick, 30_000)
    return () => { clearInterval(timer); tick() }  // flush final position on navigate-away
  }, [hlsUrl, isLoggedIn, id, activeSeason, activeEp, content])

  const dismissResume = useCallback((startOver) => {
    if (startOver) {
      const key = `dhara_progress_${id}`
      localStorage.removeItem(key)
      localStorage.removeItem(`${key}_dur`)
    }
    setResumePos(null)
  }, [id])

  // Show auth gate the moment Firebase resolves — don't wait for the content API.
  // Movie info and backdrop fill in once the fetch completes (state update re-renders).
  if (!authLoading && !isLoggedIn) {
    const bdRaw = content?.backdropUrl || content?.posterUrl || null
    const bdUrl = bdRaw
      ? cloudinaryTransform(bdRaw, 'w_1920,h_1080,c_fill,g_auto,f_auto,q_auto:low')
      : null
    const title = content ? stripExtension(content.title) : null
    return (
      <div
        className={styles.cinematicGate}
        style={bdUrl ? { '--backdrop': `url(${bdUrl})` } : {}}
      >
        <div className={styles.gateScrim} />
        <button className={styles.gateBackBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> Back
        </button>
        <div className={styles.gateCentered}>
          {title && (
            <div className={styles.gateMovieInfo}>
              {content.posterUrl && (
                <img
                  src={cloudinaryTransform(content.posterUrl, 'w_90,h_135,c_fill,f_auto,q_auto')}
                  alt={title}
                  className={styles.gatePosterThumb}
                />
              )}
              {content.genre?.length > 0 && (
                <div className={styles.gateGenres}>
                  {content.genre.slice(0, 3).map((g) => (
                    <span key={g} className={styles.gateGenreChip}>{g}</span>
                  ))}
                </div>
              )}
              <h1 className={styles.gateMovieTitle}>{title}</h1>
              <div className={styles.gateMovieMeta}>
                {content.releaseYear && <span>{content.releaseYear}</span>}
                {content.type        && <><span className={styles.gateMetaDot}>·</span><span>{content.type}</span></>}
                {content.rating > 0  && <><span className={styles.gateMetaDot}>·</span><span className={styles.gateRating}><Star size={11} fill="#db2777" color="#db2777" /> {content.rating.toFixed(1)}</span></>}
              </div>
            </div>
          )}
          <div className={styles.gatePanel}>
            <div className={styles.gatePanelIcon}><Lock size={22} /></div>
            <h2 className={styles.gatePanelTitle}>Sign in to watch</h2>
            <p className={styles.gatePanelDesc}>
              Join Dhara and enjoy unlimited Bengali cinema, series & documentaries.
            </p>
            <div className={styles.gatePanelActions}>
              <button className={styles.gatePanelBtn} onClick={() => openAuth('signin', `/watch/${id}`)}>
                <Play size={14} fill="currentColor" /> Sign In
              </button>
              <button className={styles.gatePanelBtnGhost} onClick={() => openAuth('signup', `/watch/${id}`)}>
                Create Free Account
              </button>
            </div>
            <p className={styles.gatePanelFine}>Free trial available · No credit card required</p>
          </div>
        </div>
      </div>
    )
  }

  if (loading || authLoading) return <div className={styles.state}>Loading…</div>
  if (contentError)           return <div className={styles.state}>{contentError}</div>

  const cleanTitle    = stripExtension(content.title)
  const seasons       = content?.seasons || []
  const curSeason     = seasons[activeSeason] ?? null
  const episodes      = curSeason?.episodes || []
  const activeEpisode = episodes[activeEp]
  const playerTitle   = activeEpisode
    ? `${cleanTitle} — S${curSeason.number}E${activeEpisode.number}${activeEpisode.title ? ': ' + activeEpisode.title : ''}`
    : cleanTitle
  const hasNextEp     = activeEp < episodes.length - 1
  const hasSeasons    = seasons.length > 0

  const hasGenre  = content.genre?.length > 0
  const hasRating = content.rating > 0

  // Build backdrop URL for cinematic gate
  const backdropRaw = content.backdropUrl || content.posterUrl || null
  const backdropUrl = backdropRaw
    ? cloudinaryTransform(backdropRaw, 'w_1920,h_1080,c_fill,g_auto,f_auto,q_auto:low')
    : null

  // Season 1, Episode 1 of any premium series is always a free preview — no gate
  const isFirstEpFree = content.isPremium && seasons.length > 0 && activeSeason === 0 && activeEp === 0

  // Determine which gate state we're in
  const gateState = !isLoggedIn
    ? 'unauthenticated'
    : !user?.emailVerified
    ? 'unverified'
    : content.isPremium && !isSubscribed && !isFirstEpFree && subscriptionStatus === 'lapsed'
    ? 'lapsed'
    : content.isPremium && !isSubscribed && !isFirstEpFree
    ? 'premium'
    : null

  // Compute subscription expiry labels for banners
  const formatExpiryDate = (iso) => {
    if (!iso) return null
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  const trialDaysLeft = trialEndsAt
    ? Math.ceil((new Date(trialEndsAt) - Date.now()) / 86_400_000)
    : null
  const showTrialBanner = subscriptionStatus === 'trial' && trialDaysLeft !== null && trialDaysLeft <= 7
  const showGraceBanner = subscriptionStatus === 'grace'

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
            {content.posterUrl && (
              <img
                src={cloudinaryTransform(content.posterUrl, 'w_90,h_135,c_fill,f_auto,q_auto')}
                alt={cleanTitle}
                className={styles.gatePosterThumb}
              />
            )}
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
              {hasRating           && <><span className={styles.gateMetaDot}>·</span><span className={styles.gateRating}><Star size={11} fill="#db2777" color="#db2777" /> {content.rating.toFixed(1)}</span></>}
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
                <div className={styles.gatePanelActions}>
                  <button className={styles.gatePanelBtn} onClick={() => openAuth('signin', `/watch/${id}`)}>
                    <Play size={14} fill="currentColor" /> Sign In
                  </button>
                  <button className={styles.gatePanelBtnGhost} onClick={() => openAuth('signup', `/watch/${id}`)}>
                    Create Free Account
                  </button>
                </div>
                <p className={styles.gatePanelFine}>Free trial available · No credit card required</p>
              </>
            )}

            {gateState === 'unverified' && (
              <>
                <div className={styles.gatePanelIcon} style={{ color: '#f472b6' }}><MailCheck size={22} /></div>
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
                <div className={styles.gatePanelIcon} style={{ color: '#db2777' }}><Crown size={22} /></div>
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

            {gateState === 'lapsed' && (
              <>
                <div className={styles.gatePanelIcon} style={{ color: '#f59e0b' }}><Crown size={22} /></div>
                <h2 className={styles.gatePanelTitle}>Your subscription has expired</h2>
                <p className={styles.gatePanelDesc}>
                  Renew your Dhara subscription to keep watching premium content without interruption.
                </p>
                <button className={styles.gatePanelBtn} onClick={openPaywall}>
                  <Crown size={14} /> Renew Subscription
                </button>
                <p className={styles.gatePanelFine}>Pick up right where you left off</p>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.page} ${theaterMode ? styles.pageTheater : ''}`}>
      {showGraceBanner && (
        <div className={styles.tierBannerGrace}>
          Your subscription has expired — you're in a grace period until <strong>{formatExpiryDate(graceEndsAt)}</strong>.{' '}
          <button className={styles.tierBannerLink} onClick={openPaywall}>Renew now</button>
        </div>
      )}

      {showTrialBanner && !showGraceBanner && (
        <div className={styles.tierBannerTrial}>
          Your free trial ends in <strong>{trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'}</strong>{trialEndsAt ? ` (${formatExpiryDate(trialEndsAt)})` : ''}.{' '}
          <button className={styles.tierBannerLink} onClick={openPaywall}>Subscribe to continue</button>
        </div>
      )}

      <div ref={playerWrapRef} className={styles.playerWrap}>
        {streamError ? (
          <div className={styles.streamUnavailable}>
            <VideoOff size={32} className={styles.streamUnavailableIcon} />
            <p className={styles.streamUnavailableTitle}>Video temporarily unavailable</p>
            <p className={styles.streamUnavailableDesc}>{streamError}</p>
            <button
              className={styles.streamRetryBtn}
              onClick={() => {
                setStreamError(null)
                const seasons   = content.seasons || []
                const curSeason = seasons[activeSeason] ?? null
                const seNumber  = curSeason?.number ?? null
                const epNumber  = curSeason?.episodes?.length > 0 ? (curSeason.episodes[activeEp]?.number ?? null) : null
                setHlsUrl(null)
                setSessionId(null)
                fetchStreamUrl(id, epNumber, seNumber)
                  .then(({ hlsUrl, sessionId: sid, maxQualityHeight: mqh, tier: t }) => {
                    setHlsUrl(hlsUrl)
                    setSessionId(sid ?? null)
                    setMaxQualityHeight(mqh ?? null)
                    setStreamTier(t ?? null)
                  })
                  .catch((err) => {
                    if (err.message?.includes('TOO_MANY_STREAMS') || err.message?.includes('concurrent stream')) {
                      setStreamError(err.message)
                    } else {
                      setStreamError('Video temporarily unavailable · We\'re working on it')
                    }
                  })
              }}
            >
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative', height: '100%' }}>
            <VideoPlayer
              src={hlsUrl}
              title={playerTitle}
              poster={content.posterUrl || null}
              storageKey={id}
              maxQualityHeight={maxQualityHeight}
              onPlayingChange={setPlayerPlaying}
              onBack={() => navigate(-1)}
              nextEp={hasNextEp ? { number: episodes[activeEp + 1].number, title: episodes[activeEp + 1].title } : null}
              onNextEp={hasNextEp ? () => { setActiveEp(activeEp + 1); setShowList(false) } : null}
              theaterMode={theaterMode}
              onTheaterToggle={() => setTheaterMode((s) => !s)}
              onVideoEnded={!hasNextEp ? () => setShowEndCard(true) : undefined}
              isLive={false}
              watermarkText={user?.email || user?.uid || null}
              fillContainer
            />
            {/* End card — shown when video finishes and there is no next episode */}
            {showEndCard && !hasNextEp && (
              <div className={styles.endCard} onClick={() => setShowEndCard(false)}>
                <div className={styles.endCardInner} onClick={(e) => e.stopPropagation()}>
                  <p className={styles.endCardLabel}>You watched</p>
                  <p className={styles.endCardTitle}>{playerTitle}</p>
                  <button
                    className={styles.endCardReplay}
                    onClick={() => { setShowEndCard(false); setHlsUrl(null); setTimeout(() => setHlsUrl(hlsUrl), 50) }}
                  >
                    ↺ Watch Again
                  </button>
                  {related.length > 0 && (
                    <div className={styles.endCardRelated}>
                      {related.slice(0, 4).map((item) => (
                        <button
                          key={item._id || item.id}
                          className={styles.endCardItem}
                          onClick={() => {
                            setShowEndCard(false)
                            if (item.isPremium && !isSubscribed) { openItem(item); return }
                            navigate(`/watch/${item._id || item.id}`)
                          }}
                        >
                          {item.posterUrl && (
                            <img
                              src={cloudinaryTransform(item.posterUrl, 'w_180,h_270,c_fill,f_auto,q_auto')}
                              alt={item.title}
                              className={styles.endCardPoster}
                            />
                          )}
                          <span className={styles.endCardItemTitle}>{item.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
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

      {isFirstEpFree && !isSubscribed && (
        <div className={styles.firstEpBanner}>
          <Crown size={14} className={styles.firstEpBannerIcon} />
          <span>You're watching the <strong>free preview</strong> of Episode 1 · Subscribe to unlock all episodes in full HD</span>
          <button className={styles.firstEpBannerBtn} onClick={openPaywall}>
            Subscribe — from ₹99/mo
          </button>
        </div>
      )}

      <div className={styles.below}>
        <div className={styles.info}>
          {hasNextEp && (
            <button
              className={styles.nextEpBtn}
              onClick={() => { setActiveEp(activeEp + 1); setShowList(false) }}
            >
              <SkipForward size={15} />
              Next: E{episodes[activeEp + 1].number}
              {episodes[activeEp + 1].title ? ` · ${episodes[activeEp + 1].title}` : ''}
            </button>
          )}
          {hasSeasons && (
            <button className={styles.listToggle} onClick={() => setShowList((s) => !s)}>
              <List size={16} />
              {showList ? 'Hide Episodes' : 'All Episodes'}
            </button>
          )}
        </div>

        {showList && hasSeasons && (
          <div className={styles.episodes}>
            <h2 className={styles.episodesTitle}>Episodes</h2>

            {/* Season tabs — only show if more than one season */}
            {seasons.length > 1 && (
              <div className={styles.seasonTabs}>
                {seasons.map((s, si) => (
                  <button
                    key={s.number}
                    className={`${styles.seasonTab} ${activeSeason === si ? styles.seasonTabActive : ''}`}
                    onClick={() => { setActiveSeason(si); setActiveEp(0) }}
                  >
                    Season {s.number}
                    {s.title ? ` · ${s.title}` : ''}
                  </button>
                ))}
              </div>
            )}

            <div className={styles.episodeGrid}>
              {episodes.map((ep, i) => (
                <button
                  key={ep._key || ep.number}
                  className={`${styles.episode} ${activeEp === i ? styles.episodeActive : ''}`}
                  onClick={() => setActiveEp(i)}
                >
                  <div className={styles.epNumber}>E{ep.number}</div>
                  <div className={styles.epInfo}>
                    <span className={styles.epTitle}>{ep.title}</span>
                    {ep.duration && <span className={styles.epDur}>{ep.duration}</span>}
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

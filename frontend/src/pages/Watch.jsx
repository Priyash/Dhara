import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, List, Crown, Lock, MailCheck, Star, Clapperboard, Users, Globe, Play } from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import { fetchContentById, fetchStreamUrl } from '../services/api'
import { useStore } from '../store/useStore'
import { cloudinaryTransform } from '../services/cloudinary'
import styles from './Watch.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function Watch() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { isLoggedIn, isSubscribed, user, openPaywall, openVerifyEmailGate, openAuth } = useStore()

  const [content,  setContent]  = useState(null)
  const [hlsUrl,   setHlsUrl]   = useState(null)
  const [activeEp, setActiveEp] = useState(0)
  const [showList, setShowList] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    setLoading(true)
    fetchContentById(id)
      .then(setContent)
      .catch(() => setError('Content not found.'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!content || !isLoggedIn) return
    if (!user?.emailVerified) return
    if (content.isPremium && !isSubscribed) return

    fetchStreamUrl(id)
      .then(({ hlsUrl }) => setHlsUrl(hlsUrl))
      .catch(() => setError('Could not load stream. Please try again.'))
  }, [content, id, isLoggedIn, isSubscribed, user?.emailVerified])

  if (loading) return <div className={styles.state}>Loading…</div>
  if (error)   return <div className={styles.state}>{error}</div>

  const cleanTitle    = stripExtension(content.title)
  const episodes      = content?.episodes || []
  const activeEpisode = episodes[activeEp]
  const playerTitle   = activeEpisode ? `${cleanTitle} — ${activeEpisode.title}` : cleanTitle

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
        <VideoPlayer
          src={hlsUrl}
          title={playerTitle}
          poster={content.posterUrl || null}
          storageKey={id}
        />
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
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, List, Crown, Lock, ShieldAlert, Star, Clapperboard, Users, Globe } from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import { fetchContentById, fetchStreamUrl } from '../services/api'
import { useStore } from '../store/useStore'
import styles from './Watch.module.css'

function stripExtension(name = '') {
  return name.replace(/\.(mp4|mkv|mov|avi|webm|m4v|flv|wmv|ts|mts|3gp)$/i, '').trim()
}

export default function Watch() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { isLoggedIn, isSubscribed, user, openPaywall, openVerifyEmailGate } = useStore()

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

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </div>

      <div className={styles.playerWrap}>
        {!isLoggedIn ? (
          <div className={styles.gate}>
            <Lock size={32} color="rgba(255,255,255,0.4)" />
            <p>Sign in to watch</p>
            <button className={styles.gateBtn} onClick={() => navigate('/')}>Sign in</button>
          </div>
        ) : !user?.emailVerified ? (
          <div className={styles.gate}>
            <ShieldAlert size={32} color="#fbbf24" />
            <p>Verify your email to start watching</p>
            <div className={styles.gateActions}>
              <button className={styles.gateBtn} onClick={() => openVerifyEmailGate('watch')}>Verify Email</button>
              <button className={styles.gateBtnGhost} onClick={() => navigate('/profile')}>Open Profile</button>
            </div>
          </div>
        ) : content.isPremium && !isSubscribed ? (
          <div className={styles.gate}>
            <Crown size={32} color="#f59e0b" />
            <p>Subscribe to watch premium content</p>
            <button className={styles.gateBtn} onClick={openPaywall}>Subscribe</button>
          </div>
        ) : (
          <VideoPlayer
            src={hlsUrl}
            title={playerTitle}
            poster={content.posterUrl || null}
            storageKey={id}
          />
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

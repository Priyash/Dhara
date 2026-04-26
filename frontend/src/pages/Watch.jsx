import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, List, Star, Crown, Lock } from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import { fetchContentById, fetchStreamUrl } from '../services/api'
import { useStore } from '../store/useStore'
import styles from './Watch.module.css'

export default function Watch() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const { isLoggedIn, isSubscribed, openPaywall } = useStore()

  const [content,  setContent]  = useState(null)
  const [hlsUrl,   setHlsUrl]   = useState(null)
  const [activeEp, setActiveEp] = useState(0)
  const [showList, setShowList] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  // Fetch content metadata
  useEffect(() => {
    setLoading(true)
    fetchContentById(id)
      .then(setContent)
      .catch(() => setError('Content not found.'))
      .finally(() => setLoading(false))
  }, [id])

  // Fetch stream URL once we know auth + subscription status
  useEffect(() => {
    if (!content || !isLoggedIn) return
    if (content.isPremium && !isSubscribed) return  // will show paywall CTA instead

    fetchStreamUrl(id)
      .then(({ hlsUrl }) => setHlsUrl(hlsUrl))
      .catch(() => setError('Could not load stream. Please try again.'))
  }, [content, id, isLoggedIn, isSubscribed])

  if (loading) return <div className={styles.state}>Loading…</div>
  if (error)   return <div className={styles.state}>{error}</div>

  const episodes = content?.episodes || []
  const activeEpisode = episodes[activeEp]
  const playerTitle   = content.title + (activeEpisode ? ` — ${activeEpisode.title}` : '')

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Go back">
        <ArrowLeft size={18} />
        <span>Back</span>
      </button>

      {/* Player */}
      <div className={styles.playerWrap}>
        {!isLoggedIn ? (
          <div className={styles.gate}>
            <Lock size={32} color="rgba(255,255,255,0.4)" />
            <p>Sign in to watch</p>
            <button className={styles.gateBtn} onClick={() => navigate('/')}>Sign in</button>
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
          />
        )}
      </div>

      {/* Info + episode list */}
      <div className={styles.below}>
        <div className={styles.info}>
          <div className={styles.infoLeft}>
            {content.isPremium && (
              <div className={styles.proBadge}>
                <Crown size={11} color="#fff" /> PRO
              </div>
            )}
            <h1 className={styles.title}>{content.title}</h1>
            <div className={styles.meta}>
              <Star size={12} color="#f59e0b" fill="#f59e0b" />
              <span>
                {content.rating} · {content.type}
                {content.genre?.length ? ` · ${content.genre.join(', ')}` : ''}
              </span>
            </div>
            <p className={styles.desc}>{content.desc}</p>
          </div>

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

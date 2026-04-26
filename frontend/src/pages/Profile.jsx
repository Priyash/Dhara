import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Crown, RefreshCw, Sparkles } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fetchContent } from '../services/api'
import PosterCard from '../components/PosterCard'
import styles from './Profile.module.css'

function formatJoinDate(user) {
  const raw = user?.createdAt || user?.updatedAt
  if (!raw) return 'Recently'

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'Recently'

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function Profile() {
  const navigate = useNavigate()
  const {
    isLoggedIn,
    authLoading,
    user,
    openAuth,
    openPaywall,
    refreshProfile,
  } = useStore()

  const [watchlistItems, setWatchlistItems] = useState([])
  const [loadingWatchlist, setLoadingWatchlist] = useState(false)

  const avatarLetter = user?.displayName?.[0] || user?.email?.[0] || '?'
  const watchlistIds = user?.watchlist || []

  useEffect(() => {
    if (!isLoggedIn) return

    let cancelled = false
    setLoadingWatchlist(true)

    fetchContent()
      .then((items) => {
        if (cancelled) return
        const selected = items
          .filter((item) => watchlistIds.includes(item.id))
          .slice(0, 6)
        setWatchlistItems(selected)
      })
      .catch(() => {
        if (!cancelled) setWatchlistItems([])
      })
      .finally(() => {
        if (!cancelled) setLoadingWatchlist(false)
      })

    return () => {
      cancelled = true
    }
  }, [isLoggedIn, watchlistIds])

  const planLabel = useMemo(() => {
    if (!user?.subscriptionPlan) return 'Free'
    return user.subscriptionPlan[0].toUpperCase() + user.subscriptionPlan.slice(1)
  }, [user?.subscriptionPlan])

  if (authLoading) {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>Loading your profile...</div>
      </main>
    )
  }

  if (!isLoggedIn) {
    return (
      <main className={styles.page}>
        <section className={styles.authPrompt}>
          <Sparkles size={18} />
          <h1 className={styles.authPromptTitle}>Sign in to view your profile</h1>
          <p className={styles.authPromptSub}>
            Track your watchlist and subscription details in one place.
          </p>
          <button className={styles.primaryBtn} onClick={() => openAuth('signin')}>
            Sign In
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.avatar}>{avatarLetter.toUpperCase()}</div>

        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>My Profile</p>
          <h1 className={styles.name}>{user?.displayName || 'Dhara Member'}</h1>
          <p className={styles.email}>{user?.email}</p>

          <div className={styles.metaRow}>
            <span className={styles.metaPill}>
              <CalendarDays size={14} />
              Joined {formatJoinDate(user)}
            </span>
            <span className={styles.metaPill}>
              <Crown size={14} />
              {user?.isSubscribed ? `${planLabel} Plan` : 'Free Plan'}
            </span>
          </div>
        </div>

        <button className={styles.ghostBtn} onClick={refreshProfile}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </section>

      <section className={styles.statsBand}>
        <article className={styles.statBlock}>
          <p className={styles.statLabel}>Watchlist</p>
          <p className={styles.statValue}>{watchlistIds.length}</p>
          <p className={styles.statHint}>Saved titles</p>
        </article>

        <article className={styles.statBlock}>
          <p className={styles.statLabel}>Membership</p>
          <p className={styles.statValue}>{user?.isSubscribed ? 'Active' : 'Inactive'}</p>
          <p className={styles.statHint}>{planLabel} plan</p>
        </article>

        <article className={styles.statBlock}>
          <p className={styles.statLabel}>Library</p>
          <p className={styles.statValue}>{watchlistItems.length}</p>
          <p className={styles.statHint}>Ready to stream</p>
        </article>
      </section>

      {!user?.isSubscribed && (
        <section className={styles.upsell}>
          <div>
            <p className={styles.upsellEyebrow}>Premium</p>
            <h2 className={styles.upsellTitle}>Unlock full access in HD</h2>
          </div>
          <button className={styles.primaryBtn} onClick={openPaywall}>
            Upgrade Plan
          </button>
        </section>
      )}

      <section className={styles.watchlistSection}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Your Watchlist</h2>
          <button className={styles.linkBtn} onClick={() => navigate('/browse')}>
            Browse More
          </button>
        </div>

        {loadingWatchlist ? (
          <p className={styles.empty}>Loading watchlist...</p>
        ) : watchlistItems.length === 0 ? (
          <p className={styles.empty}>No saved titles yet. Start browsing and add favorites.</p>
        ) : (
          <div className={styles.grid}>
            {watchlistItems.map((item) => (
              <PosterCard
                key={item.id}
                item={item}
                size="large"
                onClick={() => navigate(`/watch/${item.id}`)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

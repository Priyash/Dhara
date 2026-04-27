import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeAlert,
  BadgeCheck,
  CalendarDays,
  Clock3,
  Crown,
  KeyRound,
  LogOut,
  MailCheck,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
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

function formatLastLogin(user) {
  const raw = user?.lastLoginAt || user?.updatedAt
  if (!raw) return 'Just now'

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'Just now'

  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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
    openVerifyEmailGate,
    refreshProfile,
    sendPasswordReset,
    signOut,
    runScreenTransition,
  } = useStore()

  const [watchlistItems, setWatchlistItems] = useState([])
  const [loadingWatchlist, setLoadingWatchlist] = useState(false)
  const [sessionNotice, setSessionNotice] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [refreshingSession, setRefreshingSession] = useState(false)
  const [refreshCooldownSecs, setRefreshCooldownSecs] = useState(0)
  const [resettingPassword, setResettingPassword] = useState(false)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const avatarLetter = user?.displayName?.[0] || user?.email?.[0] || '?'
  const watchlistIds = user?.watchlist || []
  const canRefresh = !refreshingSession && refreshCooldownSecs === 0

  useEffect(() => {
    if (refreshCooldownSecs <= 0) return
    const timer = setTimeout(() => {
      setRefreshCooldownSecs((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearTimeout(timer)
  }, [refreshCooldownSecs])

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

  const runRefreshProfile = async () => {
    if (!canRefresh) return

    setSessionNotice('')
    setSessionError('')
    setRefreshingSession(true)
    try {
      await refreshProfile()
      setSessionNotice('Profile refreshed successfully.')
      setRefreshCooldownSecs(3)
    } catch {
      setSessionError('Could not refresh profile right now.')
    } finally {
      setRefreshingSession(false)
    }
  }

  const runPasswordReset = async () => {
    setSessionNotice('')
    setSessionError('')
    setResettingPassword(true)
    try {
      const email = await sendPasswordReset()
      setSessionNotice(`Password reset link sent to ${email}.`)
    } catch (err) {
      setSessionError(err?.message || 'Could not send password reset link.')
    } finally {
      setResettingPassword(false)
    }
  }

  const runSignOut = async () => {
    setSessionNotice('')
    setSessionError('')
    setSigningOut(true)
    try {
      await runScreenTransition('Signing you out...', async () => {
        await signOut()
        setShowSignOutConfirm(false)
        navigate('/', { replace: true })
      })
    } catch {
      setSessionError('Could not sign out right now.')
    } finally {
      setSigningOut(false)
    }
  }

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
            <span className={styles.metaPill}>
              <Clock3 size={14} />
              Last login {formatLastLogin(user)}
            </span>
            <span className={`${styles.metaPill} ${user?.emailVerified ? styles.metaPillVerified : styles.metaPillUnverified}`}>
              {user?.emailVerified ? <BadgeCheck size={14} /> : <BadgeAlert size={14} />}
              {user?.emailVerified ? 'Email verified' : 'Email not verified'}
            </span>
          </div>
        </div>

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

      <section className={styles.accountActions}>
        <div className={styles.accountHeader}>
          <p className={styles.accountEyebrow}>Account</p>
          <h2 className={styles.accountTitle}>Manage your session</h2>
          {sessionNotice && <p className={styles.sessionNotice}>{sessionNotice}</p>}
          {sessionError && <p className={styles.sessionError}>{sessionError}</p>}
        </div>
        <div className={styles.accountButtons}>
          <button className={styles.ghostBtn} onClick={runRefreshProfile} disabled={!canRefresh}>
            <RefreshCw size={14} className={refreshingSession ? styles.refreshIconSpinning : ''} />
            {refreshingSession
              ? 'Refreshing...'
              : refreshCooldownSecs > 0
                ? `Refresh (${refreshCooldownSecs}s)`
                : 'Refresh'}
          </button>
          <button className={styles.secondaryBtn} onClick={runPasswordReset} disabled={resettingPassword}>
            <KeyRound size={14} />
            {resettingPassword ? 'Sending...' : 'Reset Password'}
          </button>
          {!user?.emailVerified && (
            <button className={styles.ghostBtn} onClick={() => openVerifyEmailGate('watch')}>
              <MailCheck size={14} />
              Verify Email
            </button>
          )}
          <button className={styles.ghostBtn} onClick={openPaywall}>
            <Crown size={14} />
            {user?.isSubscribed ? 'Manage Plan' : 'Choose Plan'}
          </button>
          <button className={styles.signOutBtn} onClick={() => setShowSignOutConfirm(true)}>
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
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

      {showSignOutConfirm && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Confirm sign out">
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Sign out now?</h3>
            <p className={styles.modalSub}>
              You will be returned to the home screen and can sign in again anytime.
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setShowSignOutConfirm(false)}
                disabled={signingOut}
              >
                Cancel
              </button>
              <button
                className={styles.modalConfirmBtn}
                onClick={runSignOut}
                disabled={signingOut}
              >
                <LogOut size={14} />
                {signingOut ? 'Signing out...' : 'Yes, Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

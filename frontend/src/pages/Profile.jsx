import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
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
  Clapperboard,
  AlertOctagon,
  CheckCircle2,
  MessageSquare,
  ChevronRight,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { fetchWatchlistItems, applyAsCreator, getPaymentHistory, cancelSubscription } from '../services/api'
import PosterCard from '../components/PosterCard'
import VerifiedBadge from '../components/VerifiedBadge'
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
    creatorStatus,
    isCreator,
    setCreatorStatus,
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

  // Creator Studio application state
  const [showCreatorModal, setShowCreatorModal] = useState(false)
  const [isReapplying, setIsReapplying]         = useState(false)
  const [creatorForm, setCreatorForm] = useState({
    studioName: '', bio: '', portfolioUrl: '', sampleWorkUrl: '',
    contentTypes: [], rightsConfirmed: false, guidelinesConfirmed: false,
  })
  const [creatorApplying, setCreatorApplying] = useState(false)
  const [creatorApplyError, setCreatorApplyError] = useState('')

  const [paymentHistory, setPaymentHistory]   = useState([])
  const [loadingHistory, setLoadingHistory]   = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling,       setCancelling]         = useState(false)
  const [cancelError,      setCancelError]         = useState('')

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

    fetchWatchlistItems()
      .then((items) => {
        if (cancelled) return
        setWatchlistItems(items.slice(0, 6))
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
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return

    let cancelled = false
    setLoadingHistory(true)

    getPaymentHistory()
      .then((data) => { if (!cancelled) setPaymentHistory(data || []) })
      .catch(() => { if (!cancelled) setPaymentHistory([]) })
      .finally(() => { if (!cancelled) setLoadingHistory(false) })

    return () => { cancelled = true }
  }, [isLoggedIn])

  const planLabel = useMemo(() => {
    if (user?.subscriptionStatus === 'trial') return 'Trial'
    if (!user?.subscriptionPlan) return 'Free'
    return user.subscriptionPlan[0].toUpperCase() + user.subscriptionPlan.slice(1)
  }, [user?.subscriptionPlan, user?.subscriptionStatus])

  const trialDaysLeft = useMemo(() => {
    if (user?.subscriptionStatus !== 'trial' || !user?.trialEndsAt) return null
    const days = Math.ceil((new Date(user.trialEndsAt) - Date.now()) / 86_400_000)
    return days > 0 ? days : 0
  }, [user?.subscriptionStatus, user?.trialEndsAt])

  const canCancelSubscription = ['trial', 'active', 'grace'].includes(user?.subscriptionStatus)

  const runCancelSubscription = async () => {
    setCancelling(true)
    setCancelError('')
    try {
      await cancelSubscription()
      await refreshProfile()
      setShowCancelConfirm(false)
    } catch (err) {
      setCancelError(err?.message || 'Could not cancel subscription. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

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

  const openFreshApplication = () => {
    setIsReapplying(false)
    setCreatorApplyError('')
    setCreatorForm({
      studioName: '', bio: '', portfolioUrl: '', sampleWorkUrl: '',
      contentTypes: [], rightsConfirmed: false, guidelinesConfirmed: false,
    })
    setShowCreatorModal(true)
  }

  const openReapplication = () => {
    setIsReapplying(true)
    setCreatorApplyError('')
    setCreatorForm({
      studioName:        user?.creatorProfile?.studioName    || '',
      bio:               user?.creatorProfile?.bio            || '',
      portfolioUrl:      user?.creatorProfile?.portfolioUrl  || '',
      sampleWorkUrl:     user?.creatorProfile?.sampleWorkUrl || '',
      contentTypes:      user?.creatorProfile?.contentTypes  || [],
      rightsConfirmed:   false,   // always re-confirm
      guidelinesConfirmed: false, // always re-confirm
    })
    setShowCreatorModal(true)
  }

  const closeCreatorModal = () => {
    setShowCreatorModal(false)
    setIsReapplying(false)
    setCreatorApplyError('')
  }

  const toggleContentType = (type) =>
    setCreatorForm((p) => ({
      ...p,
      contentTypes: p.contentTypes.includes(type)
        ? p.contentTypes.filter((t) => t !== type)
        : [...p.contentTypes, type],
    }))

  const handleCreatorApply = async () => {
    if (!creatorForm.studioName.trim())      { setCreatorApplyError('Studio name is required.'); return }
    if (!creatorForm.sampleWorkUrl.trim())   { setCreatorApplyError('Please provide a link to your sample work or channel.'); return }
    if (creatorForm.contentTypes.length === 0) { setCreatorApplyError('Select at least one content type you plan to upload.'); return }
    if (!creatorForm.rightsConfirmed)        { setCreatorApplyError('Please confirm you own or have licensed all content you will upload.'); return }
    if (!creatorForm.guidelinesConfirmed)    { setCreatorApplyError('Please confirm you have read and agree to the Creator Guidelines.'); return }
    setCreatorApplying(true)
    setCreatorApplyError('')
    try {
      await applyAsCreator({
        studioName:   creatorForm.studioName,
        bio:          creatorForm.bio,
        portfolioUrl: creatorForm.portfolioUrl,
        sampleWorkUrl: creatorForm.sampleWorkUrl,
        contentTypes:  creatorForm.contentTypes,
      })
      setCreatorStatus('applied')
      setShowCreatorModal(false)
      setIsReapplying(false)
      setCreatorForm({
        studioName: '', bio: '', portfolioUrl: '', sampleWorkUrl: '',
        contentTypes: [], rightsConfirmed: false, guidelinesConfirmed: false,
      })
    } catch (err) {
      setCreatorApplyError(err?.message || 'Could not submit application.')
    } finally {
      setCreatorApplying(false)
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
          <div className={styles.nameRow}>
            <h1 className={styles.name}>{user?.displayName || 'Dhara Member'}</h1>
            {isCreator && creatorStatus === 'approved' && <VerifiedBadge size={24} />}
          </div>
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
          <p className={styles.statValue}>
            {user?.subscriptionStatus === 'trial' ? 'Trial'
              : user?.subscriptionStatus === 'active' ? 'Active'
              : user?.subscriptionStatus === 'grace'  ? 'Grace'
              : 'Inactive'}
          </p>
          <p className={styles.statHint}>
            {user?.subscriptionStatus === 'trial'
              ? trialDaysLeft !== null ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left` : 'Free trial'
              : user?.subscriptionStatus === 'grace'
                ? 'Payment issue · access at risk'
                : user?.subscriptionExpiresAt
                  ? `Expires ${new Date(user.subscriptionExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : `${planLabel} plan`}
          </p>
        </article>

        <article className={styles.statBlock}>
          <p className={styles.statLabel}>Library</p>
          <p className={styles.statValue}>{watchlistItems.length}</p>
          <p className={styles.statHint}>Ready to stream</p>
        </article>
      </section>

      {user?.subscriptionStatus === 'trial' && trialDaysLeft !== null && (
        <section className={styles.upsell} style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.12),rgba(167,139,250,0.10))', borderColor: 'rgba(167,139,250,0.2)' }}>
          <div>
            <p className={styles.upsellEyebrow}>Free Trial</p>
            <h2 className={styles.upsellTitle}>
              {trialDaysLeft > 0
                ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left in your free trial`
                : 'Your free trial has ended'}
            </h2>
          </div>
          <button className={styles.primaryBtn} onClick={openPaywall}>
            Subscribe Now
          </button>
        </section>
      )}

      {user?.subscriptionStatus === 'grace' && (
        <section className={styles.upsell} style={{ background: 'linear-gradient(135deg,rgba(225,29,72,0.10),rgba(190,18,60,0.08))', borderColor: 'rgba(225,29,72,0.28)' }}>
          <div>
            <p className={styles.upsellEyebrow} style={{ color: '#fda4af' }}>Payment Issue</p>
            <h2 className={styles.upsellTitle}>Your last payment failed</h2>
            <p className={styles.upsellSub}>
              {user?.graceEndsAt
                ? `Access continues until ${new Date(user.graceEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — renew now to avoid interruption.`
                : 'Renew now to avoid losing access.'}
            </p>
          </div>
          <button className={styles.primaryBtn} onClick={openPaywall} style={{ background: 'linear-gradient(135deg,#e11d48,#be123c)', color: '#fff' }}>
            Renew Now
          </button>
        </section>
      )}

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
          {canCancelSubscription && (
            <button className={styles.cancelBtn}
              onClick={() => { setCancelError(''); setShowCancelConfirm(true) }}>
              Cancel Subscription
            </button>
          )}
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

      {/* ── Creator Studio section ──────────────────────────────────────── */}
      <section className={`${styles.creatorCard} ${creatorStatus === 'rejected' ? styles.creatorCardRejected : ''}`}>
        <div className={styles.creatorCardLeft}>
          <div className={styles.creatorCardIcon}>
            <Clapperboard size={20} />
          </div>
          <div>
            <p className={styles.creatorCardEyebrow}>Creator Studio</p>
            <h2 className={styles.creatorCardTitle}>Share your work on Dhara</h2>
          </div>
        </div>

        <div className={styles.creatorCardRight}>

          {/* ── None: first-time CTA ── */}
          {creatorStatus === 'none' && (
            <>
              <p className={styles.creatorCardDesc}>
                Upload films, documentaries &amp; series. Submit for review — once approved, they stream to all subscribers.
              </p>
              <button className={styles.primaryBtn} onClick={openFreshApplication}>
                <Clapperboard size={14} /> Become a Creator
              </button>
            </>
          )}

          {/* ── Applied: under review ── */}
          {creatorStatus === 'applied' && (
            <>
              <span className={styles.creatorStatusPill} style={{ color: '#f472b6', background: 'rgba(244,114,182,0.1)', borderColor: 'rgba(244,114,182,0.25)' }}>
                <span className={styles.statusDotPulse} style={{ background: '#f472b6' }} />
                Application under review
              </span>
              <p className={styles.creatorCardDesc}>
                We'll notify you once an admin reviews your application. This typically takes 1–3 business days.
              </p>
              {user?.creatorProfile?.appliedAt && (
                <p className={styles.appliedOnText}>
                  Submitted {new Date(user.creatorProfile.appliedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </>
          )}

          {/* ── Rejected: full feedback panel ── */}
          {creatorStatus === 'rejected' && (
            <div className={styles.rejectionPanel}>

              {/* Header */}
              <div className={styles.rejectionHeader}>
                <div className={styles.rejectionIconWrap}>
                  <AlertOctagon size={16} />
                </div>
                <div className={styles.rejectionHeaderText}>
                  <p className={styles.rejectionTitle}>Application Not Approved</p>
                  {user?.creatorRejectedAt && (
                    <p className={styles.rejectionDate}>
                      Reviewed on {new Date(user.creatorRejectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>

              {/* Application timeline */}
              <div className={styles.applicationTimeline}>
                <div className={`${styles.timelineStep} ${styles.timelineStepDone}`}>
                  <div className={styles.timelineDot}><CheckCircle2 size={14} /></div>
                  <div className={styles.timelineInfo}>
                    <p className={styles.timelineLabel}>Applied</p>
                    {user?.creatorProfile?.appliedAt && (
                      <p className={styles.timelineSub}>
                        {new Date(user.creatorProfile.appliedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    )}
                  </div>
                </div>
                <div className={styles.timelineConnector} />
                <div className={`${styles.timelineStep} ${styles.timelineStepDone}`}>
                  <div className={styles.timelineDot}><CheckCircle2 size={14} /></div>
                  <div className={styles.timelineInfo}>
                    <p className={styles.timelineLabel}>Reviewed</p>
                    <p className={styles.timelineSub}>By admin</p>
                  </div>
                </div>
                <div className={styles.timelineConnector} />
                <div className={`${styles.timelineStep} ${styles.timelineStepFailed}`}>
                  <div className={styles.timelineDot}><AlertOctagon size={14} /></div>
                  <div className={styles.timelineInfo}>
                    <p className={styles.timelineLabel}>Not Approved</p>
                    <p className={styles.timelineSub}>See feedback below</p>
                  </div>
                </div>
              </div>

              {/* Admin feedback */}
              <div className={styles.rejectionReasonBox}>
                <p className={styles.rejectionReasonLabel}>
                  <MessageSquare size={11} /> Admin Feedback
                </p>
                <p className={styles.rejectionReasonText}>
                  {user?.creatorRejectionReason?.trim()
                    ? user.creatorRejectionReason
                    : 'No specific reason was provided. Please review our creator guidelines and ensure your application meets all requirements before reapplying.'}
                </p>
              </div>

              {/* What to do next */}
              <div className={styles.rejectionGuidance}>
                <p className={styles.rejectionGuidanceTitle}>What you can do</p>
                <ul className={styles.rejectionGuideList}>
                  <li><ChevronRight size={11} /> Address the admin feedback above before reapplying</li>
                  <li><ChevronRight size={11} /> Prepare original Bengali films, series, or documentaries</li>
                  <li><ChevronRight size={11} /> Strengthen your portfolio with links to existing work</li>
                  <li><ChevronRight size={11} /> Update your studio bio to clearly describe your creative vision</li>
                </ul>
              </div>

              {/* CTA */}
              <div className={styles.rejectionActions}>
                {user?.creatorReapplyAfter && new Date(user.creatorReapplyAfter) > new Date() ? (
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: '#f87171', fontFamily: 'var(--font-body)', margin: '0 0 6px' }}>
                      Reapply cooldown — {Math.ceil((new Date(user.creatorReapplyAfter) - Date.now()) / 86_400_000)} day{Math.ceil((new Date(user.creatorReapplyAfter) - Date.now()) / 86_400_000) !== 1 ? 's' : ''} remaining
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }}>
                      You can reapply after {new Date(user.creatorReapplyAfter).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                ) : (
                  <button
                    className={styles.rejectionReapplyBtn}
                    onClick={openReapplication}
                  >
                    <Clapperboard size={14} /> Update &amp; Reapply
                  </button>
                )}
              </div>

            </div>
          )}

          {/* ── Approved ── */}
          {creatorStatus === 'approved' && isCreator && (
            <>
              <span className={styles.creatorStatusPill} style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.1)', borderColor: 'rgba(167,139,250,0.25)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <VerifiedBadge size={14} /> Verified Creator
              </span>
              <p className={styles.creatorCardDesc}>
                Your creator account is active. Submit films, series, and documentaries from your studio.
              </p>
              <button className={styles.primaryBtn} onClick={() => navigate('/creator-studio')} style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: '#fff' }}>
                <Clapperboard size={14} /> Open Creator Studio
              </button>
            </>
          )}

        </div>
      </section>

      {/* Creator application / reapply modal */}
      {showCreatorModal && createPortal(
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalCard} style={{ maxWidth: 480 }}>

            <h3 className={styles.modalTitle}>
              {isReapplying ? 'Update & Reapply' : 'Apply as Creator'}
            </h3>
            <p className={styles.modalSub}>
              {isReapplying
                ? 'Address the admin feedback, update your profile, and resubmit for review.'
                : 'Tell us about your studio. An admin will review your application.'}
            </p>

            {/* Previous rejection context — shown only when reapplying */}
            {isReapplying && user?.creatorRejectionReason?.trim() && (
              <div className={styles.reapplyContextBox}>
                <p className={styles.reapplyContextLabel}>
                  <AlertOctagon size={11} /> Previous rejection reason
                </p>
                <p className={styles.reapplyContextText}>{user.creatorRejectionReason}</p>
              </div>
            )}

            <div className={styles.applyFormFields}>

              {/* Studio identity */}
              <label className={styles.applyFieldLabel}>
                Studio Name *
                <input
                  className={styles.applyInput}
                  value={creatorForm.studioName}
                  onChange={(e) => setCreatorForm((p) => ({ ...p, studioName: e.target.value }))}
                  placeholder="e.g. Kolkata Frames"
                  autoFocus
                />
              </label>

              <label className={styles.applyFieldLabel}>
                Bio <span className={styles.applyFieldHint}>(optional)</span>
                <textarea
                  rows={3}
                  className={styles.applyTextarea}
                  value={creatorForm.bio}
                  onChange={(e) => setCreatorForm((p) => ({ ...p, bio: e.target.value }))}
                  placeholder="Tell us about your work and creative vision…"
                />
              </label>

              {/* Verification — sample work */}
              <label className={styles.applyFieldLabel}>
                Sample Work URL *
                <span className={styles.applyFieldHint}> — YouTube, Vimeo, IMDb, festival page, or reel</span>
                <input
                  className={styles.applyInput}
                  value={creatorForm.sampleWorkUrl}
                  onChange={(e) => setCreatorForm((p) => ({ ...p, sampleWorkUrl: e.target.value }))}
                  placeholder="https://youtube.com/your-channel"
                />
              </label>

              <label className={styles.applyFieldLabel}>
                Portfolio / Website <span className={styles.applyFieldHint}>(optional)</span>
                <input
                  className={styles.applyInput}
                  value={creatorForm.portfolioUrl}
                  onChange={(e) => setCreatorForm((p) => ({ ...p, portfolioUrl: e.target.value }))}
                  placeholder="https://yoursite.com"
                />
              </label>

              {/* Content types */}
              <div className={styles.applyFieldLabel}>
                Content you plan to upload *
                <div className={styles.contentTypeRow}>
                  {['Film', 'Series', 'Serial Drama', 'Documentary'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={`${styles.contentTypeChip} ${creatorForm.contentTypes.includes(type) ? styles.contentTypeChipActive : ''}`}
                      onClick={() => toggleContentType(type)}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Legal confirmations */}
              <div className={styles.applyConfirmations}>
                <label className={styles.applyCheckRow}>
                  <input
                    type="checkbox"
                    checked={creatorForm.rightsConfirmed}
                    onChange={(e) => setCreatorForm((p) => ({ ...p, rightsConfirmed: e.target.checked }))}
                    className={styles.applyCheckbox}
                  />
                  <span className={styles.applyCheckLabel}>
                    I confirm I own or have licensed the rights to all content I will upload to Dhara.
                  </span>
                </label>
                <label className={styles.applyCheckRow}>
                  <input
                    type="checkbox"
                    checked={creatorForm.guidelinesConfirmed}
                    onChange={(e) => setCreatorForm((p) => ({ ...p, guidelinesConfirmed: e.target.checked }))}
                    className={styles.applyCheckbox}
                  />
                  <span className={styles.applyCheckLabel}>
                    I have read and agree to Dhara's Creator Guidelines and content standards.
                  </span>
                </label>
              </div>

              {creatorApplyError && (
                <p className={styles.applyError}>{creatorApplyError}</p>
              )}
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={closeCreatorModal}
                disabled={creatorApplying}
              >
                Cancel
              </button>
              <button
                className={`${styles.modalConfirmBtn} ${styles.modalConfirmCreator}`}
                onClick={handleCreatorApply}
                disabled={creatorApplying}
              >
                <Clapperboard size={13} />
                {creatorApplying
                  ? 'Submitting…'
                  : isReapplying ? 'Update & Resubmit' : 'Submit Application'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Payment History ── */}
      {(loadingHistory || paymentHistory.length > 0) && (
        <section className={styles.watchlistSection}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Payment History</h2>
          </div>
          {loadingHistory ? (
            <p className={styles.empty}>Loading…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {paymentHistory.map((t) => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  gap: 12, flexWrap: 'wrap',
                }}>
                  <div>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 2px' }}>
                      {t.planLabel || t.plan} Plan
                    </p>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                      {new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {t.orderId ? ` · ${t.orderId}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--color-text)' }}>
                      ₹{((t.amount || 0) / 100).toFixed(0)}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: t.status === 'paid' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                      color: t.status === 'paid' ? '#4ade80' : '#f87171',
                      border: `1px solid ${t.status === 'paid' ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
                    }}>
                      {t.status === 'paid' ? 'Paid' : t.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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

      {showCancelConfirm && createPortal(
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Confirm cancellation">
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Cancel subscription?</h3>
            <p className={styles.modalSub}>
              You'll lose access to premium content immediately. You can re-subscribe anytime.
            </p>
            {cancelError && (
              <p style={{ fontSize: 13, color: '#f87171', margin: '8px 0 0', fontFamily: 'var(--font-body)' }}>{cancelError}</p>
            )}
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowCancelConfirm(false)} disabled={cancelling}>
                Keep Subscription
              </button>
              <button
                className={styles.modalConfirmBtn}
                style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
                onClick={runCancelSubscription}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showSignOutConfirm && createPortal(
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
        </div>,
        document.body
      )}
    </main>
  )
}

import { useMemo, useState } from 'react'
import { BadgeCheck, Mail, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import styles from './VerifyEmailModal.module.css'

export default function VerifyEmailModal() {
  const {
    user,
    verifyEmailIntent,
    closeVerifyEmailGate,
    sendVerificationEmailLink,
    refreshVerificationStatus,
    openPaywall,
  } = useStore()

  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const title = useMemo(() => {
    if (verifyEmailIntent === 'premium') return 'Verify email to manage subscription'
    return 'Verify email to continue watching'
  }, [verifyEmailIntent])

  const sub = useMemo(() => {
    if (verifyEmailIntent === 'premium') {
      return 'For payment safety, subscription actions are available after email verification.'
    }
    return 'For account security, playback is available after email verification.'
  }, [verifyEmailIntent])

  const runResend = async () => {
    setNotice('')
    setError('')
    setSending(true)
    try {
      const email = await sendVerificationEmailLink()
      setNotice(`Verification link sent to ${email}.`)
    } catch (err) {
      setError(err?.message || 'Could not send verification link.')
    } finally {
      setSending(false)
    }
  }

  const runRefresh = async () => {
    setNotice('')
    setError('')
    setRefreshing(true)
    try {
      const verified = await refreshVerificationStatus()
      if (verified) {
        setNotice('Email verified. You are all set.')
        closeVerifyEmailGate()
        if (verifyEmailIntent === 'premium') openPaywall()
      } else {
        setError('Email is still unverified. Click the link in your inbox, then refresh.')
      }
    } catch (err) {
      setError(err?.message || 'Could not refresh verification status.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Verify your email">
      <div className={styles.modal}>
        <button className={styles.closeBtn} onClick={closeVerifyEmailGate} aria-label="Close">
          <X size={16} />
        </button>

        <div className={styles.badge}>
          <ShieldAlert size={14} />
          Email Verification Required
        </div>

        <h2 className={styles.title}>{title}</h2>
        <p className={styles.sub}>{sub}</p>

        <div className={styles.emailRow}>
          <Mail size={14} />
          <span>{user?.email || 'Signed-in email'}</span>
        </div>

        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button className={styles.ghostBtn} onClick={runResend} disabled={sending}>
            <Mail size={14} />
            {sending ? 'Sending...' : 'Resend Email'}
          </button>
          <button className={styles.primaryBtn} onClick={runRefresh} disabled={refreshing}>
            {refreshing ? <RefreshCw size={14} className={styles.spin} /> : <BadgeCheck size={14} />}
            {refreshing ? 'Checking...' : "I've Verified"}
          </button>
        </div>
      </div>
    </div>
  )
}

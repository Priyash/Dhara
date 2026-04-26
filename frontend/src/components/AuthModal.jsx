import { useState } from 'react'
import { X, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { useStore } from '../store/useStore'
import styles from './AuthModal.module.css'

function friendlyError(code) {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

export default function AuthModal() {
  const { authMode, closeAuth, signIn, signUp, setAuthMode } = useStore()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  const isSignUp = authMode === 'signup'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (isSignUp) {
        await signUp(email, password)
      } else {
        await signIn(email, password)
      }
      closeAuth()
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Sign in to Dhara">
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <button className={styles.closeBtn} onClick={closeAuth} aria-label="Close">
            <X size={16} />
          </button>
          <div className={styles.logo}>ধারা</div>
          <h2 className={styles.heading}>
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className={styles.sub}>
            {isSignUp ? 'Start watching Bengali content today' : 'Sign in to continue watching'}
          </p>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${!isSignUp ? styles.tabActive : ''}`}
            onClick={() => { setAuthMode('signin'); setError(null) }}
          >
            Sign In
          </button>
          <button
            className={`${styles.tab} ${isSignUp ? styles.tabActive : ''}`}
            onClick={() => { setAuthMode('signup'); setError(null) }}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form className={styles.body} onSubmit={handleSubmit}>
          {/* Email */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="auth-email">Email</label>
            <div className={styles.inputWrap}>
              <Mail size={16} className={styles.inputIcon} />
              <input
                id="auth-email"
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="auth-password">Password</label>
            <div className={styles.inputWrap}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                id="auth-password"
                className={styles.input}
                type={showPw ? 'text' : 'password'}
                placeholder={isSignUp ? 'Min. 6 characters' : 'Your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && <p className={styles.error}>{error}</p>}

          {/* Submit */}
          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? 'Please wait…' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>

          <p className={styles.switch}>
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              className={styles.switchLink}
              onClick={() => { setAuthMode(isSignUp ? 'signin' : 'signup'); setError(null) }}
            >
              {isSignUp ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}

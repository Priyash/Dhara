import { create } from 'zustand'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth } from '../lib/firebase.js'
import { loginWithBackend, getMe } from '../services/api.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let refreshProfileInFlight = null
let verificationSyncInFlight = null

// Optimistic hint: avoids sign-in flash for returning users.
// Set when the user logs in; cleared on sign-out or expired session.
const _authHint = typeof localStorage !== 'undefined' && localStorage.getItem('dhara:authed') === '1'

export const useStore = create((set, get) => ({
  // Auth
  isLoggedIn: _authHint,  // optimistic for returning users; confirmed by Firebase shortly after
  isSubscribed: false,
  isAdmin: false,
  subscriptionStatus: 'free',   // free | trial | active | grace | lapsed
  trialEndsAt: null,
  graceEndsAt: null,
  creatorStatus:  'none',   // none | applied | approved | rejected
  isCreator:      false,
  creatorProfile: null,
  user: null,          // MongoDB user profile
  authLoading: true,   // true while Firebase resolves the initial session

  // UI state
  showPaywall: false,
  showSearch: false,
  showAuth: false,
  authMode: 'signin',        // 'signin' | 'signup'
  authRedirectPath: null,    // where to navigate after successful sign-in/sign-up
  selectedItem: null,
  muted: true,
  transitionActive: false,
  transitionLabel: '',
  showVerifyEmail: false,
  verifyEmailIntent: null,

  // ── Auth actions ───────────────────────────────────────────────────────────

  // Call once in App.jsx to wire up the Firebase session listener.
  initAuth: () => {
    const syncSession = async (firebaseUser, { forceFreshToken = false } = {}) => {
      if (!firebaseUser) {
        localStorage.removeItem('dhara:authed')
        set({ isLoggedIn: false, isSubscribed: false, user: null, authLoading: false })
        return
      }

      try {
        if (forceFreshToken) {
          await firebaseUser.reload()
        }

        const idToken = await firebaseUser.getIdToken(forceFreshToken)
        const { user } = await loginWithBackend(idToken) // upsert in MongoDB
        localStorage.setItem('dhara:authed', '1')
        set({
          isLoggedIn:         true,
          isAdmin:            Boolean(user.isAdmin),
          isSubscribed:       user.isSubscribed,
          subscriptionStatus: user.subscriptionStatus ?? 'free',
          trialEndsAt:        user.trialEndsAt ?? null,
          graceEndsAt:        user.graceEndsAt ?? null,
          creatorStatus:      user.creatorStatus  ?? 'none',
          isCreator:          Boolean(user.isCreator),
          creatorProfile:     user.creatorProfile ?? null,
          user,
          authLoading:        false,
        })
      } catch {
        localStorage.removeItem('dhara:authed')
        set({ isLoggedIn: false, isAdmin: false, isSubscribed: false, subscriptionStatus: 'free', trialEndsAt: null, graceEndsAt: null, creatorStatus: 'none', isCreator: false, creatorProfile: null, user: null, authLoading: false })
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      await syncSession(firebaseUser, { forceFreshToken: true })
    })

    const syncVerificationOnReturn = async () => {
      if (verificationSyncInFlight) return verificationSyncInFlight

      const firebaseUser = auth.currentUser
      if (!firebaseUser) return null
      if (get().user?.emailVerified) return null

      verificationSyncInFlight = (async () => {
        try {
          await firebaseUser.reload()
          if (!firebaseUser.emailVerified) return
          await syncSession(firebaseUser, { forceFreshToken: true })
        } catch {
          // Ignore transient failures; next focus/refresh can retry.
        }
      })()

      try {
        await verificationSyncInFlight
      } finally {
        verificationSyncInFlight = null
      }
      return null
    }

    const handleFocus = () => { void syncVerificationOnReturn() }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncVerificationOnReturn()
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus)
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      unsubscribe()
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }  // call this in cleanup
  },

  signIn: async (email, password) => {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const idToken    = await credential.user.getIdToken()
    const { user }   = await loginWithBackend(idToken)
    localStorage.setItem('dhara:authed', '1')
    set({
      isLoggedIn:         true,
      isAdmin:            Boolean(user.isAdmin),
      isSubscribed:       user.isSubscribed,
      subscriptionStatus: user.subscriptionStatus ?? 'free',
      trialEndsAt:        user.trialEndsAt ?? null,
      graceEndsAt:        user.graceEndsAt ?? null,
      creatorStatus:      user.creatorStatus  ?? 'none',
      isCreator:          Boolean(user.isCreator),
      creatorProfile:     user.creatorProfile ?? null,
      user,
    })
  },

  signUp: async (email, password) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password)
    try {
      await sendEmailVerification(credential.user, {
        url: `${window.location.origin}/`,
        handleCodeInApp: false,
      })
    } catch {
      // Verification can be retried later from the account actions.
    }
    const idToken    = await credential.user.getIdToken()
    const { user }   = await loginWithBackend(idToken)
    localStorage.setItem('dhara:authed', '1')
    set({
      isLoggedIn:         true,
      isAdmin:            Boolean(user.isAdmin),
      isSubscribed:       user.isSubscribed,
      subscriptionStatus: user.subscriptionStatus ?? 'free',
      trialEndsAt:        user.trialEndsAt ?? null,
      graceEndsAt:        user.graceEndsAt ?? null,
      creatorStatus:      user.creatorStatus  ?? 'none',
      isCreator:          Boolean(user.isCreator),
      creatorProfile:     user.creatorProfile ?? null,
      user,
    })
  },

  signOut: async () => {
    await firebaseSignOut(auth)
    localStorage.removeItem('dhara:authed')
    set({ isLoggedIn: false, isAdmin: false, isSubscribed: false, subscriptionStatus: 'free', trialEndsAt: null, graceEndsAt: null, creatorStatus: 'none', isCreator: false, creatorProfile: null, user: null })
  },

  refreshProfile: async () => {
    if (refreshProfileInFlight) return refreshProfileInFlight

    refreshProfileInFlight = (async () => {
      try {
        const user = await getMe()
        set({
          isSubscribed:       user.isSubscribed,
          subscriptionStatus: user.subscriptionStatus ?? 'free',
          trialEndsAt:        user.trialEndsAt ?? null,
          graceEndsAt:        user.graceEndsAt ?? null,
          creatorStatus:      user.creatorStatus  ?? 'none',
          isCreator:          Boolean(user.isCreator),
          creatorProfile:     user.creatorProfile ?? null,
          user,
        })
      } catch { /* session expired — ignore */ }
    })()

    try {
      await refreshProfileInFlight
    } finally {
      refreshProfileInFlight = null
    }
  },

  sendPasswordReset: async () => {
    const email = auth.currentUser?.email || get().user?.email
    if (!email) throw new Error('No email found for this account')

    // Prefer provider data from the signed-in user; fetchSignInMethodsForEmail can
    // return ambiguous results under stricter Firebase anti-enumeration settings.
    const providerIds = auth.currentUser?.providerData?.map((p) => p.providerId).filter(Boolean) || []
    if (providerIds.length > 0 && !providerIds.includes('password')) {
      throw new Error('This account is not using email/password sign-in.')
    }

    try {
      await sendPasswordResetEmail(auth, email, {
        url: `${window.location.origin}/`,
        handleCodeInApp: false,
      })
    } catch (err) {
      const code = err?.code || ''
      if (code === 'auth/too-many-requests') {
        throw new Error('Too many reset attempts. Please wait a few minutes and try again.')
      }
      if (code === 'auth/operation-not-allowed') {
        throw new Error('Password sign-in is disabled in Firebase Authentication settings.')
      }
      if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
        throw new Error('Reset link domain is not authorized. Add your app domain in Firebase Auth settings.')
      }
      if (code === 'auth/network-request-failed') {
        throw new Error('Network error while sending reset email. Please check your connection and retry.')
      }
      throw new Error('Reset email could not be sent. Please check Firebase Auth email settings.')
    }

    return email
  },

  sendVerificationEmailLink: async () => {
    const firebaseUser = auth.currentUser
    const email = firebaseUser?.email || get().user?.email
    if (!firebaseUser || !email) throw new Error('No signed-in account found')

    if (firebaseUser.emailVerified || get().user?.emailVerified) {
      return email
    }

    try {
      await sendEmailVerification(firebaseUser, {
        url: `${window.location.origin}/`,
        handleCodeInApp: false,
      })
    } catch (err) {
      const code = err?.code || ''
      if (code === 'auth/too-many-requests') {
        throw new Error('Too many requests. Please wait a bit before trying again.')
      }
      if (code === 'auth/network-request-failed') {
        throw new Error('Network error while sending verification email.')
      }
      throw new Error('Could not send verification email right now.')
    }

    return email
  },

  refreshVerificationStatus: async () => {
    const firebaseUser = auth.currentUser
    if (!firebaseUser) throw new Error('No signed-in account found')

    await firebaseUser.reload()
    const idToken = await firebaseUser.getIdToken(true)
    const { user } = await loginWithBackend(idToken)
    set({
      isSubscribed:       user.isSubscribed,
      subscriptionStatus: user.subscriptionStatus ?? 'free',
      trialEndsAt:        user.trialEndsAt ?? null,
      graceEndsAt:        user.graceEndsAt ?? null,
      creatorStatus:      user.creatorStatus  ?? 'none',
      isCreator:          Boolean(user.isCreator),
      creatorProfile:     user.creatorProfile ?? null,
      user,
    })
    return user.emailVerified
  },

  runScreenTransition: async (label, action, timings = { enter: 120, exit: 140 }) => {
    set({ transitionActive: true, transitionLabel: label || '' })
    try {
      await wait(timings.enter)
      if (action) await action()
      await wait(timings.exit)
    } finally {
      set({ transitionActive: false, transitionLabel: '' })
    }
  },

  // ── UI actions ─────────────────────────────────────────────────────────────

  setCreatorStatus: (status) => set({ creatorStatus: status }),
  setShowPaywall: (val) => set({ showPaywall: val }),
  setShowSearch:  (val) => set({ showSearch: val }),
  setSelectedItem:(item) => set({ selectedItem: item }),
  toggleMuted:    () => set((s) => ({ muted: !s.muted })),

  // redirectPath — where to go after successful auth. Pass the current URL
  // (e.g. `/watch/${id}`) when the user was trying to do something specific.
  // Omit for generic sign-in (Navbar button, Reels likes) — defaults to staying put.
  openAuth:    (mode = 'signin', redirectPath = null) => set({ showAuth: true, authMode: mode, authRedirectPath: redirectPath }),
  closeAuth:   () => set({ showAuth: false, authRedirectPath: null }),
  setAuthMode: (mode) => set({ authMode: mode }),

  openPaywall: () => {
    const { isLoggedIn, user, openAuth } = get()
    if (!isLoggedIn) {
      openAuth('signin')
      return
    }

    if (!user?.emailVerified) {
      set({ showVerifyEmail: true, verifyEmailIntent: 'premium', selectedItem: null })
      return
    }

    set({ showPaywall: true, selectedItem: null })
  },
  openVerifyEmailGate: (intent = 'watch') => set({ showVerifyEmail: true, verifyEmailIntent: intent }),
  closeVerifyEmailGate: () => set({ showVerifyEmail: false, verifyEmailIntent: null }),
  openItem:    (item) => set({ selectedItem: item }),
  closeAll:    () => set({
    showPaywall: false,
    showSearch: false,
    selectedItem: null,
    showVerifyEmail: false,
    verifyEmailIntent: null,
  }),
}))

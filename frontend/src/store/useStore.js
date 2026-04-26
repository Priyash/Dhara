import { create } from 'zustand'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth } from '../lib/firebase.js'
import { loginWithBackend, getMe } from '../services/api.js'

export const useStore = create((set, get) => ({
  // Auth
  isLoggedIn: false,
  isSubscribed: false,
  user: null,          // MongoDB user profile
  authLoading: true,   // true while Firebase resolves the initial session

  // UI state
  showPaywall: false,
  showSearch: false,
  showAuth: false,
  authMode: 'signin',   // 'signin' | 'signup'
  selectedItem: null,
  muted: true,

  // ── Auth actions ───────────────────────────────────────────────────────────

  // Call once in App.jsx to wire up the Firebase session listener.
  initAuth: () => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const idToken = await firebaseUser.getIdToken()
          const { user } = await loginWithBackend(idToken)  // upsert in MongoDB
          set({ isLoggedIn: true, isSubscribed: user.isSubscribed, user, authLoading: false })
        } catch {
          set({ isLoggedIn: false, isSubscribed: false, user: null, authLoading: false })
        }
      } else {
        set({ isLoggedIn: false, isSubscribed: false, user: null, authLoading: false })
      }
    })
    return unsubscribe  // call this in the cleanup of the useEffect
  },

  signIn: async (email, password) => {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const idToken    = await credential.user.getIdToken()
    const { user }   = await loginWithBackend(idToken)
    set({ isLoggedIn: true, isSubscribed: user.isSubscribed, user })
  },

  signUp: async (email, password) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password)
    const idToken    = await credential.user.getIdToken()
    const { user }   = await loginWithBackend(idToken)
    set({ isLoggedIn: true, isSubscribed: user.isSubscribed, user })
  },

  signOut: async () => {
    await firebaseSignOut(auth)
    set({ isLoggedIn: false, isSubscribed: false, user: null })
  },

  refreshProfile: async () => {
    try {
      const user = await getMe()
      set({ isSubscribed: user.isSubscribed, user })
    } catch { /* session expired — ignore */ }
  },

  // ── UI actions ─────────────────────────────────────────────────────────────

  setShowPaywall: (val) => set({ showPaywall: val }),
  setShowSearch:  (val) => set({ showSearch: val }),
  setSelectedItem:(item) => set({ selectedItem: item }),
  toggleMuted:    () => set((s) => ({ muted: !s.muted })),

  openAuth:    (mode = 'signin') => set({ showAuth: true, authMode: mode }),
  closeAuth:   () => set({ showAuth: false }),
  setAuthMode: (mode) => set({ authMode: mode }),

  openPaywall: () => set({ showPaywall: true, selectedItem: null }),
  openItem:    (item) => set({ selectedItem: item }),
  closeAll:    () => set({ showPaywall: false, showSearch: false, selectedItem: null }),
}))

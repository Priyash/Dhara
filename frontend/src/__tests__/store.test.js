/**
 * Zustand store tests — imports the real useStore module (no reimplementation).
 * Module-level state (the store, the authHint) means every test resets modules
 * and re-imports fresh so tests don't leak state into each other.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let currentUser = null

vi.mock('../lib/firebase.js', () => ({
  auth: {
    get currentUser() { return currentUser },
  },
}))

const signInWithEmailAndPassword     = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const firebaseSignOut                = vi.fn().mockResolvedValue(undefined)
const onAuthStateChanged             = vi.fn(() => () => {})
const sendEmailVerification          = vi.fn().mockResolvedValue(undefined)
const sendPasswordResetEmail         = vi.fn().mockResolvedValue(undefined)

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword:     (...args) => signInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: (...args) => createUserWithEmailAndPassword(...args),
  signOut:                        (...args) => firebaseSignOut(...args),
  onAuthStateChanged:              (...args) => onAuthStateChanged(...args),
  sendEmailVerification:           (...args) => sendEmailVerification(...args),
  sendPasswordResetEmail:          (...args) => sendPasswordResetEmail(...args),
}))

const loginWithBackend = vi.fn()
const getMe             = vi.fn()

vi.mock('../services/api.js', () => ({
  loginWithBackend: (...args) => loginWithBackend(...args),
  getMe:             (...args) => getMe(...args),
}))

let useStore

beforeEach(async () => {
  vi.resetModules()
  currentUser = null
  signInWithEmailAndPassword.mockReset()
  createUserWithEmailAndPassword.mockReset()
  firebaseSignOut.mockClear()
  onAuthStateChanged.mockReset().mockReturnValue(() => {})
  sendEmailVerification.mockReset().mockResolvedValue(undefined)
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
  loginWithBackend.mockReset()
  getMe.mockReset()
  localStorage.clear()
  ;({ useStore } = await import('../store/useStore.js'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const backendUser = (overrides = {}) => ({
  isAdmin: false,
  isSubscribed: false,
  subscriptionStatus: 'free',
  subscriptionPlan: null,
  subscriptionExpiresAt: null,
  trialEndsAt: null,
  graceEndsAt: null,
  creatorStatus: 'none',
  isCreator: false,
  creatorProfile: null,
  emailVerified: true,
  ...overrides,
})

// ── Initial state ──────────────────────────────────────────────────────────

describe('initial state', () => {
  it('isLoggedIn is false when there is no auth hint in localStorage', () => {
    expect(useStore.getState().isLoggedIn).toBe(false)
  })

  it('isLoggedIn is true (optimistic) when the auth hint is set', async () => {
    localStorage.setItem('dhara:authed', '1')
    vi.resetModules()
    ;({ useStore } = await import('../store/useStore.js'))
    expect(useStore.getState().isLoggedIn).toBe(true)
  })

  it('defaults to free/unsubscribed/non-admin/non-creator', () => {
    const s = useStore.getState()
    expect(s.isSubscribed).toBe(false)
    expect(s.isAdmin).toBe(false)
    expect(s.subscriptionStatus).toBe('free')
    expect(s.creatorStatus).toBe('none')
    expect(s.isCreator).toBe(false)
    expect(s.authLoading).toBe(true)
    expect(s.activeUploads).toEqual([])
  })
})

// ── signIn ──────────────────────────────────────────────────────────────────

describe('signIn', () => {
  it('signs in, syncs with backend, and persists the auth hint', async () => {
    signInWithEmailAndPassword.mockResolvedValue({
      user: { getIdToken: vi.fn().mockResolvedValue('tok-1') },
    })
    loginWithBackend.mockResolvedValue({ user: backendUser({ isSubscribed: true, subscriptionStatus: 'active' }) })

    await useStore.getState().signIn('a@b.com', 'pw')

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'a@b.com', 'pw')
    expect(loginWithBackend).toHaveBeenCalledWith('tok-1')
    expect(localStorage.getItem('dhara:authed')).toBe('1')

    const s = useStore.getState()
    expect(s.isLoggedIn).toBe(true)
    expect(s.isSubscribed).toBe(true)
    expect(s.subscriptionStatus).toBe('active')
  })

  it('propagates Firebase sign-in errors without mutating state', async () => {
    signInWithEmailAndPassword.mockRejectedValue(new Error('wrong-password'))

    await expect(useStore.getState().signIn('a@b.com', 'bad')).rejects.toThrow('wrong-password')
    expect(useStore.getState().isLoggedIn).toBe(false)
  })
})

// ── signUp ──────────────────────────────────────────────────────────────────

describe('signUp', () => {
  it('creates the account, sends a verification email, and syncs with backend', async () => {
    const fbUser = { getIdToken: vi.fn().mockResolvedValue('tok-2') }
    createUserWithEmailAndPassword.mockResolvedValue({ user: fbUser })
    loginWithBackend.mockResolvedValue({ user: backendUser() })

    await useStore.getState().signUp('new@b.com', 'pw')

    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'new@b.com', 'pw')
    expect(sendEmailVerification).toHaveBeenCalledWith(fbUser, expect.objectContaining({ handleCodeInApp: false }))
    expect(useStore.getState().isLoggedIn).toBe(true)
  })

  it('tolerates a failed verification-email send and still completes sign-up', async () => {
    const fbUser = { getIdToken: vi.fn().mockResolvedValue('tok-3') }
    createUserWithEmailAndPassword.mockResolvedValue({ user: fbUser })
    sendEmailVerification.mockRejectedValue(new Error('quota'))
    loginWithBackend.mockResolvedValue({ user: backendUser() })

    await expect(useStore.getState().signUp('new@b.com', 'pw')).resolves.toBeUndefined()
    expect(useStore.getState().isLoggedIn).toBe(true)
  })
})

// ── signOut ─────────────────────────────────────────────────────────────────

describe('signOut', () => {
  it('signs out of Firebase, clears the auth hint, and resets state', async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: { getIdToken: vi.fn().mockResolvedValue('t') } })
    loginWithBackend.mockResolvedValue({ user: backendUser({ isSubscribed: true, isAdmin: true }) })
    await useStore.getState().signIn('a@b.com', 'pw')

    await useStore.getState().signOut()

    expect(firebaseSignOut).toHaveBeenCalled()
    expect(localStorage.getItem('dhara:authed')).toBeNull()
    const s = useStore.getState()
    expect(s.isLoggedIn).toBe(false)
    expect(s.isAdmin).toBe(false)
    expect(s.isSubscribed).toBe(false)
    expect(s.user).toBeNull()
  })
})

// ── refreshProfile ────────────────────────────────────────────────────────

describe('refreshProfile', () => {
  it('fetches the latest profile and updates subscription/creator fields', async () => {
    getMe.mockResolvedValue(backendUser({ isSubscribed: true, subscriptionStatus: 'grace' }))

    await useStore.getState().refreshProfile()

    expect(getMe).toHaveBeenCalledTimes(1)
    const s = useStore.getState()
    expect(s.isSubscribed).toBe(true)
    expect(s.subscriptionStatus).toBe('grace')
  })

  it('swallows errors (e.g. expired session) without throwing', async () => {
    getMe.mockRejectedValue(new Error('401'))
    await expect(useStore.getState().refreshProfile()).resolves.toBeUndefined()
  })

  it('deduplicates concurrent calls into a single in-flight request', async () => {
    let resolveGetMe
    getMe.mockReturnValue(new Promise((resolve) => { resolveGetMe = resolve }))

    const p1 = useStore.getState().refreshProfile()
    const p2 = useStore.getState().refreshProfile()
    resolveGetMe(backendUser())
    await Promise.all([p1, p2])

    expect(getMe).toHaveBeenCalledTimes(1)
  })
})

// ── sendPasswordReset ───────────────────────────────────────────────────────

describe('sendPasswordReset', () => {
  it('throws when there is no known email', async () => {
    await expect(useStore.getState().sendPasswordReset()).rejects.toThrow('No email found')
  })

  it('sends the reset email and resolves with the address', async () => {
    currentUser = { email: 'me@b.com', providerData: [{ providerId: 'password' }] }
    await expect(useStore.getState().sendPasswordReset()).resolves.toBe('me@b.com')
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'me@b.com', expect.anything())
  })

  it('rejects non-password accounts (e.g. Google sign-in) before sending', async () => {
    currentUser = { email: 'me@b.com', providerData: [{ providerId: 'google.com' }] }
    await expect(useStore.getState().sendPasswordReset()).rejects.toThrow('not using email/password')
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  const CASES = [
    ['auth/too-many-requests', /Too many reset attempts/],
    ['auth/operation-not-allowed', /disabled in Firebase/],
    ['auth/unauthorized-continue-uri', /domain is not authorized/],
    ['auth/invalid-continue-uri', /domain is not authorized/],
    ['auth/network-request-failed', /Network error/],
    ['auth/something-else', /could not be sent/],
  ]
  for (const [code, message] of CASES) {
    it(`maps Firebase error code "${code}" to a friendly message`, async () => {
      currentUser = { email: 'me@b.com', providerData: [] }
      sendPasswordResetEmail.mockRejectedValue({ code })
      await expect(useStore.getState().sendPasswordReset()).rejects.toThrow(message)
    })
  }
})

// ── sendVerificationEmailLink ───────────────────────────────────────────────

describe('sendVerificationEmailLink', () => {
  it('throws when there is no signed-in account', async () => {
    await expect(useStore.getState().sendVerificationEmailLink()).rejects.toThrow('No signed-in account')
  })

  it('returns early without sending when the Firebase user is already verified', async () => {
    currentUser = { email: 'me@b.com', emailVerified: true }
    await expect(useStore.getState().sendVerificationEmailLink()).resolves.toBe('me@b.com')
    expect(sendEmailVerification).not.toHaveBeenCalled()
  })

  it('returns early without sending when the backend profile is already verified', async () => {
    currentUser = { email: 'me@b.com', emailVerified: false }
    useStore.setState({ user: backendUser({ emailVerified: true }) })
    await expect(useStore.getState().sendVerificationEmailLink()).resolves.toBe('me@b.com')
    expect(sendEmailVerification).not.toHaveBeenCalled()
  })

  it('sends a verification email when unverified', async () => {
    currentUser = { email: 'me@b.com', emailVerified: false }
    await expect(useStore.getState().sendVerificationEmailLink()).resolves.toBe('me@b.com')
    expect(sendEmailVerification).toHaveBeenCalled()
  })

  const CASES = [
    ['auth/too-many-requests', /Too many requests/],
    ['auth/network-request-failed', /Network error/],
    ['auth/something-else', /Could not send/],
  ]
  for (const [code, message] of CASES) {
    it(`maps Firebase error code "${code}" to a friendly message`, async () => {
      currentUser = { email: 'me@b.com', emailVerified: false }
      sendEmailVerification.mockRejectedValue({ code })
      await expect(useStore.getState().sendVerificationEmailLink()).rejects.toThrow(message)
    })
  }
})

// ── refreshVerificationStatus ───────────────────────────────────────────────

describe('refreshVerificationStatus', () => {
  it('throws when there is no signed-in account', async () => {
    await expect(useStore.getState().refreshVerificationStatus()).rejects.toThrow('No signed-in account')
  })

  it('reloads the Firebase user, re-syncs with backend, and returns emailVerified', async () => {
    currentUser = { reload: vi.fn().mockResolvedValue(undefined), getIdToken: vi.fn().mockResolvedValue('tok') }
    loginWithBackend.mockResolvedValue({ user: backendUser({ emailVerified: true }) })

    await expect(useStore.getState().refreshVerificationStatus()).resolves.toBe(true)
    expect(currentUser.reload).toHaveBeenCalled()
    expect(currentUser.getIdToken).toHaveBeenCalledWith(true)
    expect(useStore.getState().user.emailVerified).toBe(true)
  })
})

// ── runScreenTransition ──────────────────────────────────────────────────────

describe('runScreenTransition', () => {
  it('toggles transitionActive around the action and restores it on completion', async () => {
    const action = vi.fn()
    const promise = useStore.getState().runScreenTransition('Loading…', action, { enter: 0, exit: 0 })
    expect(useStore.getState().transitionActive).toBe(true)
    expect(useStore.getState().transitionLabel).toBe('Loading…')

    await promise
    expect(action).toHaveBeenCalled()
    expect(useStore.getState().transitionActive).toBe(false)
    expect(useStore.getState().transitionLabel).toBe('')
  })

  it('restores transitionActive to false even when the action throws', async () => {
    const action = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      useStore.getState().runScreenTransition('x', action, { enter: 0, exit: 0 }),
    ).rejects.toThrow('boom')
    expect(useStore.getState().transitionActive).toBe(false)
  })
})

// ── UI action setters ────────────────────────────────────────────────────────

describe('UI action setters', () => {
  it('setCreatorStatus / setShowPaywall / setShowSearch / setSelectedItem', () => {
    const { setCreatorStatus, setShowPaywall, setShowSearch, setSelectedItem } = useStore.getState()
    setCreatorStatus('approved')
    setShowPaywall(true)
    setShowSearch(true)
    setSelectedItem({ id: '1' })

    const s = useStore.getState()
    expect(s.creatorStatus).toBe('approved')
    expect(s.showPaywall).toBe(true)
    expect(s.showSearch).toBe(true)
    expect(s.selectedItem).toEqual({ id: '1' })
  })

  it('toggleMuted flips the muted flag', () => {
    expect(useStore.getState().muted).toBe(true)
    useStore.getState().toggleMuted()
    expect(useStore.getState().muted).toBe(false)
    useStore.getState().toggleMuted()
    expect(useStore.getState().muted).toBe(true)
  })

  it('openAuth sets mode and redirect path; closeAuth clears them', () => {
    useStore.getState().openAuth('signup', '/watch/42')
    let s = useStore.getState()
    expect(s.showAuth).toBe(true)
    expect(s.authMode).toBe('signup')
    expect(s.authRedirectPath).toBe('/watch/42')

    useStore.getState().closeAuth()
    s = useStore.getState()
    expect(s.showAuth).toBe(false)
    expect(s.authRedirectPath).toBeNull()
  })

  it('setAuthMode updates the mode independently', () => {
    useStore.getState().setAuthMode('signup')
    expect(useStore.getState().authMode).toBe('signup')
  })

  it('openItem sets selectedItem; closeAll clears all overlay flags', () => {
    useStore.getState().openItem({ id: '7' })
    useStore.getState().setShowPaywall(true)
    useStore.getState().setShowSearch(true)
    useStore.getState().openVerifyEmailGate('watch')

    useStore.getState().closeAll()
    const s = useStore.getState()
    expect(s.showPaywall).toBe(false)
    expect(s.showSearch).toBe(false)
    expect(s.selectedItem).toBeNull()
    expect(s.showVerifyEmail).toBe(false)
    expect(s.verifyEmailIntent).toBeNull()
  })

  it('openVerifyEmailGate / closeVerifyEmailGate', () => {
    useStore.getState().openVerifyEmailGate('comment')
    expect(useStore.getState().showVerifyEmail).toBe(true)
    expect(useStore.getState().verifyEmailIntent).toBe('comment')

    useStore.getState().closeVerifyEmailGate()
    expect(useStore.getState().showVerifyEmail).toBe(false)
    expect(useStore.getState().verifyEmailIntent).toBeNull()
  })
})

// ── openPaywall guard ─────────────────────────────────────────────────────────

describe('openPaywall', () => {
  it('routes to sign-in when not logged in', () => {
    useStore.getState().openPaywall()
    const s = useStore.getState()
    expect(s.showAuth).toBe(true)
    expect(s.authMode).toBe('signin')
    expect(s.showPaywall).toBe(false)
  })

  it('routes to the email-verify gate when logged in but unverified', () => {
    useStore.setState({ isLoggedIn: true, user: backendUser({ emailVerified: false }) })
    useStore.getState().openPaywall()
    const s = useStore.getState()
    expect(s.showVerifyEmail).toBe(true)
    expect(s.verifyEmailIntent).toBe('premium')
    expect(s.showPaywall).toBe(false)
  })

  it('opens the paywall when logged in and verified', () => {
    useStore.setState({ isLoggedIn: true, user: backendUser({ emailVerified: true }), selectedItem: { id: '1' } })
    useStore.getState().openPaywall()
    const s = useStore.getState()
    expect(s.showPaywall).toBe(true)
    expect(s.selectedItem).toBeNull()
  })
})

// ── Active uploads tracking ───────────────────────────────────────────────────

describe('active uploads tracking', () => {
  it('addActiveUpload appends an upload', () => {
    useStore.getState().addActiveUpload({ uid: 'u1', progress: 0 })
    expect(useStore.getState().activeUploads).toEqual([{ uid: 'u1', progress: 0 }])
  })

  it('patchActiveUpload merges fields onto the matching upload only', () => {
    useStore.getState().addActiveUpload({ uid: 'u1', progress: 0 })
    useStore.getState().addActiveUpload({ uid: 'u2', progress: 0 })
    useStore.getState().patchActiveUpload('u1', { progress: 50 })

    const uploads = useStore.getState().activeUploads
    expect(uploads.find((u) => u.uid === 'u1').progress).toBe(50)
    expect(uploads.find((u) => u.uid === 'u2').progress).toBe(0)
  })

  it('removeActiveUpload removes only the matching upload', () => {
    useStore.getState().addActiveUpload({ uid: 'u1' })
    useStore.getState().addActiveUpload({ uid: 'u2' })
    useStore.getState().removeActiveUpload('u1')

    expect(useStore.getState().activeUploads).toEqual([{ uid: 'u2' }])
  })
})

// ── initAuth ──────────────────────────────────────────────────────────────────

describe('initAuth', () => {
  it('wires an onAuthStateChanged listener and returns a cleanup function', () => {
    const cleanup = useStore.getState().initAuth()
    expect(onAuthStateChanged).toHaveBeenCalled()
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('syncs to a signed-out state when the callback fires with no user', async () => {
    let callback
    onAuthStateChanged.mockImplementation((_auth, cb) => { callback = cb; return () => {} })
    useStore.getState().initAuth()

    await callback(null)

    const s = useStore.getState()
    expect(s.isLoggedIn).toBe(false)
    expect(s.authLoading).toBe(false)
  })

  it('syncs to a signed-in state when the callback fires with a Firebase user', async () => {
    let callback
    onAuthStateChanged.mockImplementation((_auth, cb) => { callback = cb; return () => {} })
    loginWithBackend.mockResolvedValue({ user: backendUser({ isSubscribed: true }) })
    useStore.getState().initAuth()

    const fbUser = {
      uid: 'uid-1',
      reload: vi.fn().mockResolvedValue(undefined),
      getIdToken: vi.fn().mockResolvedValue('tok'),
    }
    await callback(fbUser)

    const s = useStore.getState()
    expect(s.isLoggedIn).toBe(true)
    expect(s.isSubscribed).toBe(true)
    expect(localStorage.getItem('dhara:authed')).toBe('1')
  })

  it('falls back to signed-out state when the backend sync fails', async () => {
    let callback
    onAuthStateChanged.mockImplementation((_auth, cb) => { callback = cb; return () => {} })
    loginWithBackend.mockRejectedValue(new Error('500'))
    useStore.getState().initAuth()

    const fbUser = { uid: 'uid-1', reload: vi.fn().mockResolvedValue(undefined), getIdToken: vi.fn().mockResolvedValue('tok') }
    await callback(fbUser)

    expect(useStore.getState().isLoggedIn).toBe(false)
  })

  it('reloads the page when a different user authenticates in another tab', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
      configurable: true,
    })

    let callback
    onAuthStateChanged.mockImplementation((_auth, cb) => { callback = cb; return () => {} })
    loginWithBackend.mockResolvedValue({ user: backendUser() })
    useStore.getState().initAuth()

    const userA = { uid: 'uid-A', reload: vi.fn().mockResolvedValue(undefined), getIdToken: vi.fn().mockResolvedValue('a') }
    const userB = { uid: 'uid-B', reload: vi.fn().mockResolvedValue(undefined), getIdToken: vi.fn().mockResolvedValue('b') }
    await callback(userA)
    await callback(userB)

    expect(reload).toHaveBeenCalled()
  })
})

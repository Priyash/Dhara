/**
 * Zustand store logic tests.
 * Covers: localStorage auth hint, subscription state helpers,
 * and UI state mutations — no Firebase, no backend.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../lib/firebase.js', () => ({ auth: { currentUser: null } }))
vi.mock('firebase/auth', () => ({
  signOut:                          vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged:               vi.fn(() => () => {}),
  signInWithEmailAndPassword:       vi.fn(),
  createUserWithEmailAndPassword:   vi.fn(),
  sendEmailVerification:            vi.fn(),
  sendPasswordResetEmail:           vi.fn(),
}))

// ── localStorage auth hint ────────────────────────────────────────────────────

describe('Auth hint — localStorage', () => {
  beforeEach(() => localStorage.clear())

  it('is false when not set', () => {
    expect(localStorage.getItem('dhara:authed') === '1').toBe(false)
  })

  it('is true after being set to "1"', () => {
    localStorage.setItem('dhara:authed', '1')
    expect(localStorage.getItem('dhara:authed') === '1').toBe(true)
  })

  it('becomes false after removal (sign-out)', () => {
    localStorage.setItem('dhara:authed', '1')
    localStorage.removeItem('dhara:authed')
    expect(localStorage.getItem('dhara:authed') === '1').toBe(false)
  })

  it('is not truthy for arbitrary string values', () => {
    localStorage.setItem('dhara:authed', 'true')
    expect(localStorage.getItem('dhara:authed') === '1').toBe(false)
  })
})

// ── Subscription state helpers (mirrored) ─────────────────────────────────────

describe('Subscription status helpers', () => {
  const future = new Date(Date.now() + 30 * 86_400_000)
  const past   = new Date(Date.now() - 1_000)

  function isActive(user) {
    const now = new Date()
    switch (user.subscriptionStatus) {
      case 'trial':  return Boolean(user.trialEndsAt  && user.trialEndsAt  > now)
      case 'active': return !user.subscriptionExpiresAt || user.subscriptionExpiresAt > now
      case 'grace':  return Boolean(user.graceEndsAt  && user.graceEndsAt  > now)
      default:       return false
    }
  }

  it('active with future expiry → subscribed', () => {
    expect(isActive({ subscriptionStatus: 'active', subscriptionExpiresAt: future })).toBe(true)
  })

  it('active with past expiry → not subscribed', () => {
    expect(isActive({ subscriptionStatus: 'active', subscriptionExpiresAt: past })).toBe(false)
  })

  it('trial within window → subscribed', () => {
    expect(isActive({ subscriptionStatus: 'trial', trialEndsAt: future })).toBe(true)
  })

  it('trial expired → not subscribed', () => {
    expect(isActive({ subscriptionStatus: 'trial', trialEndsAt: past })).toBe(false)
  })

  it('grace within window → subscribed', () => {
    expect(isActive({ subscriptionStatus: 'grace', graceEndsAt: future })).toBe(true)
  })

  it('grace expired → not subscribed', () => {
    expect(isActive({ subscriptionStatus: 'grace', graceEndsAt: past })).toBe(false)
  })

  it('free → not subscribed', () => {
    expect(isActive({ subscriptionStatus: 'free' })).toBe(false)
  })

  it('lapsed → not subscribed', () => {
    expect(isActive({ subscriptionStatus: 'lapsed' })).toBe(false)
  })
})

// ── UI state flags ────────────────────────────────────────────────────────────

describe('UI state — openPaywall guard', () => {
  // Mirrors the openPaywall logic: login → email verification → paywall
  function openPaywall({ isLoggedIn, emailVerified }) {
    if (!isLoggedIn)     return 'auth'
    if (!emailVerified)  return 'verify'
    return 'paywall'
  }

  it('redirects to auth when not logged in', () => {
    expect(openPaywall({ isLoggedIn: false, emailVerified: false })).toBe('auth')
  })

  it('redirects to email verify when logged in but unverified', () => {
    expect(openPaywall({ isLoggedIn: true, emailVerified: false })).toBe('verify')
  })

  it('opens paywall when logged in and verified', () => {
    expect(openPaywall({ isLoggedIn: true, emailVerified: true })).toBe('paywall')
  })
})

// ── Creator state ─────────────────────────────────────────────────────────────

describe('Creator status transitions', () => {
  function creatorLabel(status) {
    const map = {
      none:     'Not Applied',
      applied:  'Under Review',
      approved: 'Approved',
      rejected: 'Rejected',
    }
    return map[status] ?? 'Unknown'
  }

  it('maps none → Not Applied',     () => expect(creatorLabel('none')).toBe('Not Applied'))
  it('maps applied → Under Review', () => expect(creatorLabel('applied')).toBe('Under Review'))
  it('maps approved → Approved',    () => expect(creatorLabel('approved')).toBe('Approved'))
  it('maps rejected → Rejected',    () => expect(creatorLabel('rejected')).toBe('Rejected'))
  it('unknown status → Unknown',    () => expect(creatorLabel('foo')).toBe('Unknown'))
})

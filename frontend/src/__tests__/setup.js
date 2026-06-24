import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Default mock so any module that transitively imports `lib/firebase.js`
// (e.g. via useStore) doesn't try to initialize a real Firebase app with
// invalid test env vars. Test files that need specific auth behaviour
// override this with their own vi.mock(...) call.
vi.mock('../lib/firebase.js', () => ({ auth: { currentUser: null } }))
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword:     vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut:                        vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged:              vi.fn(() => () => {}),
  sendEmailVerification:           vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail:          vi.fn().mockResolvedValue(undefined),
}))

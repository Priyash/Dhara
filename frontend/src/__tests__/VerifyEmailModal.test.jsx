import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useStore } from '../store/useStore'
import VerifyEmailModal from '../components/VerifyEmailModal'

function setup(overrides = {}) {
  useStore.setState({
    user: { email: 'me@b.com' },
    verifyEmailIntent: 'watch',
    closeVerifyEmailGate: vi.fn(),
    sendVerificationEmailLink: vi.fn().mockResolvedValue('me@b.com'),
    refreshVerificationStatus: vi.fn().mockResolvedValue(false),
    openPaywall: vi.fn(),
    ...overrides,
  })
}

describe('VerifyEmailModal', () => {
  it('shows the watch-intent copy by default', () => {
    setup()
    render(<VerifyEmailModal />)
    expect(screen.getByText('Verify email to continue watching')).toBeInTheDocument()
  })

  it('shows the premium-intent copy when verifyEmailIntent is "premium"', () => {
    setup({ verifyEmailIntent: 'premium' })
    render(<VerifyEmailModal />)
    expect(screen.getByText('Verify email to manage subscription')).toBeInTheDocument()
  })

  it('displays the signed-in email', () => {
    setup()
    render(<VerifyEmailModal />)
    expect(screen.getByText('me@b.com')).toBeInTheDocument()
  })

  it('close button calls closeVerifyEmailGate', () => {
    setup()
    render(<VerifyEmailModal />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(useStore.getState().closeVerifyEmailGate).toHaveBeenCalled()
  })

  it('resending shows a success notice with the email', async () => {
    setup()
    render(<VerifyEmailModal />)
    fireEvent.click(screen.getByText('Resend Email'))
    await waitFor(() => expect(screen.getByText('Verification link sent to me@b.com.')).toBeInTheDocument())
  })

  it('resending shows an error message on failure', async () => {
    setup({ sendVerificationEmailLink: vi.fn().mockRejectedValue(new Error('Too many requests.')) })
    render(<VerifyEmailModal />)
    fireEvent.click(screen.getByText('Resend Email'))
    await waitFor(() => expect(screen.getByText('Too many requests.')).toBeInTheDocument())
  })

  it('refresh shows "still unverified" error when not yet verified', async () => {
    setup({ refreshVerificationStatus: vi.fn().mockResolvedValue(false) })
    render(<VerifyEmailModal />)
    fireEvent.click(screen.getByText("I've Verified"))
    await waitFor(() => expect(screen.getByText(/still unverified/)).toBeInTheDocument())
  })

  it('refresh closes the gate and opens the paywall when verified with premium intent', async () => {
    setup({ verifyEmailIntent: 'premium', refreshVerificationStatus: vi.fn().mockResolvedValue(true) })
    render(<VerifyEmailModal />)
    fireEvent.click(screen.getByText("I've Verified"))
    await waitFor(() => expect(useStore.getState().closeVerifyEmailGate).toHaveBeenCalled())
    expect(useStore.getState().openPaywall).toHaveBeenCalled()
  })

  it('refresh closes the gate without opening the paywall for non-premium intent', async () => {
    setup({ verifyEmailIntent: 'watch', refreshVerificationStatus: vi.fn().mockResolvedValue(true) })
    render(<VerifyEmailModal />)
    fireEvent.click(screen.getByText("I've Verified"))
    await waitFor(() => expect(useStore.getState().closeVerifyEmailGate).toHaveBeenCalled())
    expect(useStore.getState().openPaywall).not.toHaveBeenCalled()
  })
})

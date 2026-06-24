import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../store/useStore'
import ReelUploadsToast from '../components/ReelUploadsToast'

describe('ReelUploadsToast', () => {
  it('renders nothing when there are no reel uploads', () => {
    useStore.setState({ activeUploads: [] })
    const { container } = render(<ReelUploadsToast />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ignores non-reel uploads', () => {
    useStore.setState({ activeUploads: [{ uid: 'u1', type: 'movie', title: 'Film' }] })
    const { container } = render(<ReelUploadsToast />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows upload progress for an in-flight reel upload', () => {
    useStore.setState({ activeUploads: [{ uid: 'u1', type: 'reel', title: 'My Reel', progress: 40 }] })
    render(<ReelUploadsToast />)
    expect(screen.getByText('My Reel')).toBeInTheDocument()
    expect(screen.getByText('40% uploading…')).toBeInTheDocument()
  })

  it('shows "Processing…" once progress reaches 100 but is not yet done', () => {
    useStore.setState({ activeUploads: [{ uid: 'u1', type: 'reel', title: 'My Reel', progress: 100 }] })
    render(<ReelUploadsToast />)
    expect(screen.getByText('Processing…')).toBeInTheDocument()
  })

  it('shows the error message for a failed upload', () => {
    useStore.setState({ activeUploads: [{ uid: 'u1', type: 'reel', title: 'My Reel', status: 'error', error: 'Encode failed' }] })
    render(<ReelUploadsToast />)
    expect(screen.getByText('Encode failed')).toBeInTheDocument()
  })

  it('cancelling an in-flight upload aborts the xhr and marks it cancelled', () => {
    const abort = vi.fn()
    useStore.setState({ activeUploads: [{ uid: 'u1', type: 'reel', title: 'My Reel', progress: 50, xhr: { abort } }] })
    render(<ReelUploadsToast />)
    fireEvent.click(screen.getByLabelText('Cancel upload'))

    expect(abort).toHaveBeenCalled()
    const upload = useStore.getState().activeUploads.find((u) => u.uid === 'u1')
    expect(upload.status).toBe('cancelled')
    expect(upload.xhr).toBeNull()
  })

  it('dismissing a terminal upload removes it from the store', () => {
    useStore.setState({ activeUploads: [{ uid: 'u1', type: 'reel', title: 'My Reel', status: 'done' }] })
    render(<ReelUploadsToast />)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(useStore.getState().activeUploads).toHaveLength(0)
  })
})

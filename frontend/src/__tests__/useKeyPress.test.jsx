import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyPress } from '../hooks/useKeyPress'

describe('useKeyPress', () => {
  afterEach(() => vi.restoreAllMocks())

  it('calls handler when the matching key is pressed', () => {
    const handler = vi.fn()
    renderHook(() => useKeyPress('Escape', handler))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not call handler for a different key', () => {
    const handler = vi.fn()
    renderHook(() => useKeyPress('Escape', handler))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes the event through to the handler', () => {
    const handler = vi.fn()
    renderHook(() => useKeyPress('ArrowLeft', handler))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ key: 'ArrowLeft' }))
  })

  it('removes the listener on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useKeyPress('Escape', handler))
    unmount()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('re-binds when the key prop changes', () => {
    const handler = vi.fn()
    const { rerender } = renderHook(({ key }) => useKeyPress(key, handler), {
      initialProps: { key: 'Escape' },
    })

    rerender({ key: 'Enter' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(handler).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

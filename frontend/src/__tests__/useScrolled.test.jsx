import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScrolled } from '../hooks/useScrolled'

describe('useScrolled', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns false before any scroll', () => {
    const { result } = renderHook(() => useScrolled(60))
    expect(result.current).toBe(false)
  })

  it('returns true when scrolled past threshold', () => {
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true })
    const { result } = renderHook(() => useScrolled(60))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(true)
  })

  it('respects a custom threshold', () => {
    Object.defineProperty(window, 'scrollY', { value: 30, writable: true, configurable: true })
    const { result } = renderHook(() => useScrolled(50))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(false)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWatchlist } from '../hooks/useWatchlist'

const STORAGE_KEY = 'dhara_watchlist'

describe('useWatchlist', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty when localStorage has nothing', () => {
    const { result } = renderHook(() => useWatchlist())
    expect(result.current.watchlist).toEqual([])
  })

  it('loads existing items from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: '1', title: 'Film A' }]))
    const { result } = renderHook(() => useWatchlist())
    expect(result.current.watchlist).toHaveLength(1)
    expect(result.current.watchlist[0].title).toBe('Film A')
  })

  it('falls back to empty array when localStorage contains invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    const { result } = renderHook(() => useWatchlist())
    expect(result.current.watchlist).toEqual([])
  })

  it('add() appends an item and persists it', () => {
    const { result } = renderHook(() => useWatchlist())
    act(() => result.current.add({ id: '1', title: 'Film A' }))

    expect(result.current.watchlist).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual([{ id: '1', title: 'Film A' }])
  })

  it('add() is a no-op for an item already in the list', () => {
    const { result } = renderHook(() => useWatchlist())
    act(() => result.current.add({ id: '1', title: 'Film A' }))
    act(() => result.current.add({ id: '1', title: 'Film A (dup)' }))

    expect(result.current.watchlist).toHaveLength(1)
    expect(result.current.watchlist[0].title).toBe('Film A')
  })

  it('remove() removes an item and persists the change', () => {
    const { result } = renderHook(() => useWatchlist())
    act(() => result.current.add({ id: '1', title: 'Film A' }))
    act(() => result.current.remove('1'))

    expect(result.current.watchlist).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual([])
  })

  it('toggle() adds an absent item', () => {
    const { result } = renderHook(() => useWatchlist())
    act(() => result.current.toggle({ id: '1', title: 'Film A' }))
    expect(result.current.watchlist).toHaveLength(1)
  })

  it('toggle() removes a present item', () => {
    const { result } = renderHook(() => useWatchlist())
    act(() => result.current.add({ id: '1', title: 'Film A' }))
    act(() => result.current.toggle({ id: '1', title: 'Film A' }))
    expect(result.current.watchlist).toEqual([])
  })

  it('isInList() reflects membership', () => {
    const { result } = renderHook(() => useWatchlist())
    expect(result.current.isInList('1')).toBe(false)
    act(() => result.current.add({ id: '1', title: 'Film A' }))
    expect(result.current.isInList('1')).toBe(true)
  })

  it('save() failure (e.g. quota exceeded) does not throw', () => {
    const { result } = renderHook(() => useWatchlist())
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }

    expect(() => act(() => result.current.add({ id: '1', title: 'Film A' }))).not.toThrow()
    expect(result.current.watchlist).toHaveLength(1)

    Storage.prototype.setItem = original
  })
})

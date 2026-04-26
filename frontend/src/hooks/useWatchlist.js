import { useState, useCallback } from 'react'

const STORAGE_KEY = 'dhara_watchlist'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Storage full or blocked — fail silently
  }
}

/**
 * Manages the user's watchlist with localStorage persistence.
 *
 * @returns {{ watchlist, add, remove, toggle, isInList }}
 */
export function useWatchlist() {
  const [watchlist, setWatchlist] = useState(load)

  const add = useCallback((item) => {
    setWatchlist((prev) => {
      if (prev.find((i) => i.id === item.id)) return prev
      const next = [...prev, item]
      save(next)
      return next
    })
  }, [])

  const remove = useCallback((id) => {
    setWatchlist((prev) => {
      const next = prev.filter((i) => i.id !== id)
      save(next)
      return next
    })
  }, [])

  const toggle = useCallback(
    (item) => {
      watchlist.find((i) => i.id === item.id) ? remove(item.id) : add(item)
    },
    [watchlist, add, remove],
  )

  const isInList = useCallback(
    (id) => watchlist.some((i) => i.id === id),
    [watchlist],
  )

  return { watchlist, add, remove, toggle, isInList }
}

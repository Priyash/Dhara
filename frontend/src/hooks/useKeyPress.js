import { useEffect } from 'react'

/**
 * Calls `handler` when the given keyboard key is pressed.
 * Automatically removes the listener on unmount.
 *
 * @param {string} key - e.g. 'Escape', 'ArrowLeft'
 * @param {(event: KeyboardEvent) => void} handler
 */
export function useKeyPress(key, handler) {
  useEffect(() => {
    const listener = (e) => {
      if (e.key === key) handler(e)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [key, handler])
}

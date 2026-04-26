import { useState, useEffect } from 'react'

/**
 * Returns true when the page has scrolled past `threshold` pixels.
 * Useful for sticky nav transitions.
 */
export function useScrolled(threshold = 60) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  return scrolled
}

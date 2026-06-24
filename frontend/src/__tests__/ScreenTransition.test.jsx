import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { useStore } from '../store/useStore'
import ScreenTransition from '../components/ScreenTransition'

describe('ScreenTransition', () => {
  it('is aria-hidden when not transitioning', () => {
    useStore.setState({ transitionActive: false })
    const { container } = render(<ScreenTransition />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('is not aria-hidden while transitioning', () => {
    useStore.setState({ transitionActive: true })
    const { container } = render(<ScreenTransition />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'false')
  })
})

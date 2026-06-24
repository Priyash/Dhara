import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import VerifiedBadge from '../components/VerifiedBadge'

describe('VerifiedBadge', () => {
  it('renders an svg labelled "Verified Creator"', () => {
    const { container } = render(<VerifiedBadge />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-label', 'Verified Creator')
  })

  it('defaults to size 16', () => {
    const { container } = render(<VerifiedBadge />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
  })

  it('respects a custom size', () => {
    const { container } = render(<VerifiedBadge size={32} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('height', '32')
  })

  it('generates unique gradient ids across instances', () => {
    const { container } = render(
      <div>
        <VerifiedBadge />
        <VerifiedBadge />
      </div>,
    )
    const ids = [...container.querySelectorAll('linearGradient')].map((el) => el.id)
    expect(ids[0]).not.toBe(ids[1])
  })
})

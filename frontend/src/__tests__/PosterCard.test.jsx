import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PosterCard from '../components/PosterCard'

vi.mock('../services/api.js', () => ({
  fetchTrailerUrl: vi.fn(),
  recordInteractionEvent: vi.fn().mockResolvedValue(undefined),
}))

const baseItem = { id: '1', title: 'Film A.mp4', type: 'Film', genre: ['Drama', 'Romance', 'Thriller'] }

describe('PosterCard', () => {
  it('renders the title with the file extension stripped', () => {
    render(<PosterCard item={baseItem} />)
    expect(screen.getByText('Film A')).toBeInTheDocument()
  })

  it('shows at most 2 genre chips', () => {
    render(<PosterCard item={baseItem} />)
    expect(screen.getByText('Drama')).toBeInTheDocument()
    expect(screen.getByText('Romance')).toBeInTheDocument()
    expect(screen.queryByText('Thriller')).not.toBeInTheDocument()
  })

  it('shows a PRO badge for premium content', () => {
    render(<PosterCard item={{ ...baseItem, isPremium: true }} />)
    expect(screen.getByText('PRO')).toBeInTheDocument()
  })

  it('shows a LIVE corner badge when item.badge is LIVE', () => {
    render(<PosterCard item={{ ...baseItem, badge: 'LIVE' }} />)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('shows the rating badge only when there is no other corner badge', () => {
    render(<PosterCard item={{ ...baseItem, rating: 4.5 }} />)
    expect(screen.getByText('4.5')).toBeInTheDocument()
  })

  it('hides the rating badge when a corner badge is present', () => {
    render(<PosterCard item={{ ...baseItem, rating: 4.5, badge: 'NEW' }} />)
    expect(screen.queryByText('4.5')).not.toBeInTheDocument()
  })

  it('shows a progress bar based on _progress', () => {
    const item = { ...baseItem, _progress: { positionSecs: 30, durationSecs: 60 } }
    const { container } = render(<PosterCard item={item} />)
    expect(container.querySelector('[class*="progressFill"]')).toHaveStyle({ width: '50%' })
  })

  it('calls onClick with the item when clicked', () => {
    const onClick = vi.fn()
    render(<PosterCard item={baseItem} onClick={onClick} />)
    fireEvent.click(screen.getByLabelText('Film A, Film'))
    expect(onClick).toHaveBeenCalledWith(baseItem)
  })

  it('calls onClick on Enter keydown', () => {
    const onClick = vi.fn()
    render(<PosterCard item={baseItem} onClick={onClick} />)
    fireEvent.keyDown(screen.getByLabelText('Film A, Film'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledWith(baseItem)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PosterCard from '../components/PosterCard'
import { recordInteractionEvent, chooseThumbnailVariant } from '../services/api.js'

vi.mock('../services/api.js', () => ({
  fetchTrailerUrl: vi.fn(),
  recordInteractionEvent: vi.fn().mockResolvedValue(undefined),
  chooseThumbnailVariant: vi.fn(() => null),
  rememberShownVariant: vi.fn(),
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

describe('PosterCard — artwork A/B variant', () => {
  const variantItem = { ...baseItem, posterUrl: 'https://cdn/original.jpg' }

  beforeEach(() => {
    recordInteractionEvent.mockClear()
    chooseThumbnailVariant.mockReturnValue({ imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/variant.jpg', variantId: 'v9' })
  })

  it('renders the chosen variant image instead of the original poster', () => {
    const { container } = render(<PosterCard item={variantItem} />)
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('variant.jpg')
  })

  it('fires a click event attributed to the variant', () => {
    render(<PosterCard item={variantItem} onClick={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Film A, Film'))
    expect(recordInteractionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: '1', eventType: 'click', variantId: 'v9' })
    )
  })

  it('falls back to the original poster when the variant image fails to load', () => {
    const { container } = render(<PosterCard item={variantItem} />)
    const img = container.querySelector('img')
    fireEvent.error(img)
    const after = container.querySelector('img')
    expect(after.getAttribute('src')).toContain('original.jpg')
  })
})

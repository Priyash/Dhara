import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CinematicRow from '../components/CinematicRow'

const item = (i, extra = {}) => ({ id: String(i), title: `Film ${i}.mp4`, genre: ['Drama'], ...extra })

describe('CinematicRow', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<CinematicRow title="Spotlight" items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one card per item with the extension stripped', () => {
    render(<CinematicRow title="Spotlight" items={[item(1), item(2)]} />)
    expect(screen.getByLabelText('Film 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Film 2')).toBeInTheDocument()
  })

  it('shows the genre and a badge when present', () => {
    render(<CinematicRow title="Spotlight" items={[item(1, { badge: 'LIVE' })]} />)
    expect(screen.getByText('Drama')).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('calls onCardClick with the clicked item', () => {
    const onCardClick = vi.fn()
    const items = [item(1)]
    render(<CinematicRow title="Spotlight" items={items} onCardClick={onCardClick} />)
    fireEvent.click(screen.getByLabelText('Film 1'))
    expect(onCardClick).toHaveBeenCalledWith(items[0])
  })

  it('calls onSeeAll when provided', () => {
    const onSeeAll = vi.fn()
    render(<CinematicRow title="Spotlight" items={[item(1)]} onSeeAll={onSeeAll} />)
    fireEvent.click(screen.getByText('See all'))
    expect(onSeeAll).toHaveBeenCalled()
  })
})

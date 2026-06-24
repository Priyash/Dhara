import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GenreMosaic from '../components/GenreMosaic'

const item = (i) => ({ id: String(i), title: `Film ${i}.mp4` })

describe('GenreMosaic', () => {
  it('renders nothing with fewer than 5 items', () => {
    const { container } = render(<GenreMosaic title="Top Picks" items={[item(1), item(2)]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a large tile for the first item and small tiles for the rest', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(i))
    render(<GenreMosaic title="Top Picks" items={items} />)
    expect(screen.getByLabelText('Film 0')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^Film \d$/)).toHaveLength(5)
  })

  it('strips the file extension from the title', () => {
    render(<GenreMosaic title="Top Picks" items={Array.from({ length: 5 }, (_, i) => item(i))} />)
    expect(screen.queryByText('Film 0.mp4')).not.toBeInTheDocument()
    expect(screen.getByText('Film 0')).toBeInTheDocument()
  })

  it('calls onCardClick with the clicked item', () => {
    const onCardClick = vi.fn()
    const items = Array.from({ length: 5 }, (_, i) => item(i))
    render(<GenreMosaic title="Top Picks" items={items} onCardClick={onCardClick} />)
    fireEvent.click(screen.getByLabelText('Film 0'))
    expect(onCardClick).toHaveBeenCalledWith(items[0])
  })

  it('renders the "see all" button only when onSeeAll is provided', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(i))
    const { rerender } = render(<GenreMosaic title="Top Picks" items={items} />)
    expect(screen.queryByText('See all')).not.toBeInTheDocument()

    rerender(<GenreMosaic title="Top Picks" items={items} onSeeAll={vi.fn()} />)
    expect(screen.getByText('See all')).toBeInTheDocument()
  })
})

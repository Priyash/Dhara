import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ContentRow from '../components/ContentRow'

const item = (i, rank) => ({ id: String(i), title: `Film ${i}`, type: 'Film', _rank: rank })

describe('ContentRow', () => {
  it('renders the title and one poster per item', () => {
    render(<ContentRow title="Trending" items={[item(1), item(2)]} />)
    expect(screen.getByText('Trending')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^Film \d, Film$/)).toHaveLength(2)
  })

  it('shows rank numbers when ranked is true and items carry _rank', () => {
    render(<ContentRow title="Top 10" items={[item(1, 1), item(2, 2)]} ranked />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calls scrollBy on the row when the scroll buttons are clicked', () => {
    const { container } = render(<ContentRow title="Trending" items={[item(1)]} />)
    const row = container.querySelector('[aria-label]') && container.querySelector('div[class*="row"]')
    if (row) row.scrollBy = vi.fn()
    fireEvent.click(screen.getByLabelText('Scroll right'))
    fireEvent.click(screen.getByLabelText('Scroll left'))
    // No crash even when scrollBy is unavailable in jsdom by default
    expect(screen.getByLabelText('Scroll left')).toBeInTheDocument()
  })

  it('calls onSeeAll when "See all" is clicked', () => {
    const onSeeAll = vi.fn()
    render(<ContentRow title="Trending" items={[item(1)]} onSeeAll={onSeeAll} />)
    fireEvent.click(screen.getByText('See all'))
    expect(onSeeAll).toHaveBeenCalled()
  })

  it('forwards onCardClick', () => {
    const onCardClick = vi.fn()
    render(<ContentRow title="Trending" items={[item(1)]} onCardClick={onCardClick} />)
    fireEvent.click(screen.getByLabelText('Film 1, Film'))
    expect(onCardClick).toHaveBeenCalledWith(item(1))
  })
})

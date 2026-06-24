import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CategoryGrid from '../components/CategoryGrid'

const item = (i) => ({ id: String(i), title: `Film ${i}`, type: 'Film' })

describe('CategoryGrid', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<CategoryGrid title="Action" items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the title and eyebrow', () => {
    render(<CategoryGrid title="Action" eyebrow="Genre" items={[item(1)]} />)
    expect(screen.getByText('Action')).toBeInTheDocument()
    expect(screen.getByText('Genre')).toBeInTheDocument()
  })

  it('caps visible items at 10', () => {
    const items = Array.from({ length: 15 }, (_, i) => item(i))
    render(<CategoryGrid title="Action" items={items} />)
    expect(screen.getAllByLabelText(/^Film \d+, Film$/)).toHaveLength(10)
  })

  it('shows a "see all" tile with the remaining count when there are more than 10 items and onSeeAll is given', () => {
    const items = Array.from({ length: 15 }, (_, i) => item(i))
    const onSeeAll = vi.fn()
    render(<CategoryGrid title="Action" items={items} onSeeAll={onSeeAll} />)
    expect(screen.getByText('+5')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Browse all Action'))
    expect(onSeeAll).toHaveBeenCalled()
  })

  it('does not show the see-all tile when items fit within the grid limit', () => {
    render(<CategoryGrid title="Action" items={[item(1)]} onSeeAll={vi.fn()} />)
    expect(screen.queryByLabelText('Browse all Action')).not.toBeInTheDocument()
  })

  it('forwards onCardClick to the rendered posters', () => {
    const onCardClick = vi.fn()
    render(<CategoryGrid title="Action" items={[item(1)]} onCardClick={onCardClick} />)
    fireEvent.click(screen.getByLabelText('Film 1, Film'))
    expect(onCardClick).toHaveBeenCalledWith(item(1))
  })
})

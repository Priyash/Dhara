import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WideResumeCard from '../components/WideResumeCard'

describe('WideResumeCard', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<WideResumeCard items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a single wide card for one item, with progress', () => {
    const items = [{ id: '1', title: 'Film A.mp4', progressPct: 42 }]
    render(<WideResumeCard items={items} />)
    expect(screen.getByText('Film A')).toBeInTheDocument()
    expect(screen.getByText('42% watched')).toBeInTheDocument()
  })

  it('renders a scroll rail for multiple items', () => {
    const items = [
      { id: '1', title: 'Film A', progressPct: 10 },
      { id: '2', title: 'Film B', progressPct: 20 },
    ]
    render(<WideResumeCard items={items} />)
    expect(screen.getByText('Film A')).toBeInTheDocument()
    expect(screen.getByText('Film B')).toBeInTheDocument()
    expect(screen.getByText('10% watched')).toBeInTheDocument()
    expect(screen.getByText('20% watched')).toBeInTheDocument()
  })

  it('calls onCardClick when the single card is clicked', () => {
    const onCardClick = vi.fn()
    const items = [{ id: '1', title: 'Film A' }]
    render(<WideResumeCard items={items} onCardClick={onCardClick} />)
    fireEvent.click(screen.getByText('Film A'))
    expect(onCardClick).toHaveBeenCalledWith(items[0])
  })

  it('calls onCardClick when a rail thumbnail is clicked', () => {
    const onCardClick = vi.fn()
    const items = [
      { id: '1', title: 'Film A' },
      { id: '2', title: 'Film B' },
    ]
    render(<WideResumeCard items={items} onCardClick={onCardClick} />)
    fireEvent.click(screen.getByLabelText('Resume Film B'))
    expect(onCardClick).toHaveBeenCalledWith(items[1])
  })
})

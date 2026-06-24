import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

import CuratedShelfRow from '../components/CuratedShelfRow'

const shelf = (items = [{ id: '1', title: 'Film A' }]) => ({
  name: 'Bengali Classics',
  items,
})

describe('CuratedShelfRow', () => {
  it('renders nothing when the shelf has no items', () => {
    const { container } = render(<CuratedShelfRow shelf={shelf([])} />, { wrapper: MemoryRouter })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the shelf name and one poster per item', () => {
    render(<CuratedShelfRow shelf={shelf([{ id: '1', title: 'Film A' }, { id: '2', title: 'Film B' }])} />, {
      wrapper: MemoryRouter,
    })
    expect(screen.getByText('Bengali Classics')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^Film [AB], undefined$/).length).toBe(2)
  })

  it('navigates to /browse when "See all" is clicked', () => {
    render(<CuratedShelfRow shelf={shelf()} />, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByText(/See all/))
    expect(navigateMock).toHaveBeenCalledWith('/browse')
  })

  it('forwards onCardClick', () => {
    const onCardClick = vi.fn()
    const items = [{ id: '1', title: 'Film A' }]
    render(<CuratedShelfRow shelf={shelf(items)} onCardClick={onCardClick} />, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByLabelText('Film A, undefined'))
    expect(onCardClick).toHaveBeenCalledWith(items[0])
  })
})

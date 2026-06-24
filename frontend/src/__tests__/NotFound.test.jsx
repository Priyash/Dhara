import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

import NotFound from '../pages/NotFound'

describe('NotFound', () => {
  it('renders the 404 message', () => {
    render(<NotFound />, { wrapper: MemoryRouter })
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByText('Page not found')).toBeInTheDocument()
  })

  it('navigates home when the button is clicked', () => {
    render(<NotFound />, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByText('Go home'))
    expect(navigateMock).toHaveBeenCalledWith('/')
  })
})

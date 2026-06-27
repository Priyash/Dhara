import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ThumbnailVariantModal from '../components/ThumbnailVariantModal'

const api = {
  list:   vi.fn(),
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  remove: vi.fn().mockResolvedValue({}),
}

const item = { _id: 'c1', title: 'Bhalobashar Bari' }
const renderModal = () => render(<ThumbnailVariantModal item={item} api={api} onClose={() => {}} />)

function variant(over = {}) {
  return {
    _id: 'v1', imageUrl: 'https://cdn/a.jpg', label: 'warm', status: 'candidate',
    stats: { impressions: 100, clicks: 12, plays: 0, completions: 0, ctr: 0.12, cvr: 0 },
    ...over,
  }
}

describe('ThumbnailVariantModal', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockClear?.())
  })

  it('loads and renders a variant with its CTR', async () => {
    api.list.mockResolvedValue([variant()])
    renderModal()

    expect(await screen.findByText(/Artwork A\/B — Bhalobashar Bari/)).toBeInTheDocument()
    expect(await screen.findByText('12.0%')).toBeInTheDocument()
    expect(api.list).toHaveBeenCalled()
  })

  it('promotes a candidate to live', async () => {
    api.list.mockResolvedValue([variant()])
    renderModal()

    const liveBtn = await screen.findByTitle('Set live')
    fireEvent.click(liveBtn)
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('v1', { status: 'live' }))
  })

  it('rejects an invalid image URL without calling the API', async () => {
    api.list.mockResolvedValue([])
    renderModal()
    await screen.findByText(/No variants yet/)

    fireEvent.change(screen.getByPlaceholderText(/artwork\.jpg/), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByText('Add'))
    expect(api.create).not.toHaveBeenCalled()
    expect(await screen.findByText(/valid http\(s\) image URL/)).toBeInTheDocument()
  })
})

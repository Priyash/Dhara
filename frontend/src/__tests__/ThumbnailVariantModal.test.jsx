import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ThumbnailVariantModal from '../components/ThumbnailVariantModal'

const api = {
  listAdminThumbnailVariants: vi.fn(),
  createAdminThumbnailVariant: vi.fn().mockResolvedValue({}),
  updateAdminThumbnailVariant: vi.fn().mockResolvedValue({}),
  deleteAdminThumbnailVariant: vi.fn().mockResolvedValue({}),
}
vi.mock('../services/api', () => ({
  listAdminThumbnailVariants: (...a) => api.listAdminThumbnailVariants(...a),
  createAdminThumbnailVariant: (...a) => api.createAdminThumbnailVariant(...a),
  updateAdminThumbnailVariant: (...a) => api.updateAdminThumbnailVariant(...a),
  deleteAdminThumbnailVariant: (...a) => api.deleteAdminThumbnailVariant(...a),
}))

const item = { _id: 'c1', title: 'Bhalobashar Bari' }

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
    api.listAdminThumbnailVariants.mockResolvedValue([variant()])
    render(<ThumbnailVariantModal item={item} onClose={() => {}} />)

    expect(await screen.findByText(/Artwork A\/B — Bhalobashar Bari/)).toBeInTheDocument()
    expect(await screen.findByText('12.0%')).toBeInTheDocument()
    expect(api.listAdminThumbnailVariants).toHaveBeenCalledWith('content', 'c1')
  })

  it('promotes a candidate to live', async () => {
    api.listAdminThumbnailVariants.mockResolvedValue([variant()])
    render(<ThumbnailVariantModal item={item} onClose={() => {}} />)

    const liveBtn = await screen.findByTitle('Set live')
    fireEvent.click(liveBtn)
    await waitFor(() => expect(api.updateAdminThumbnailVariant).toHaveBeenCalledWith('v1', { status: 'live' }))
  })

  it('rejects an invalid image URL without calling the API', async () => {
    api.listAdminThumbnailVariants.mockResolvedValue([])
    render(<ThumbnailVariantModal item={item} onClose={() => {}} />)
    await screen.findByText(/No variants yet/)

    fireEvent.change(screen.getByPlaceholderText(/artwork\.jpg/), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByText('Add'))
    expect(api.createAdminThumbnailVariant).not.toHaveBeenCalled()
    expect(await screen.findByText(/valid http\(s\) image URL/)).toBeInTheDocument()
  })
})

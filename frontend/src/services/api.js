import { auth } from '../lib/firebase.js'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeaders()),
    ...options.headers,
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// MongoDB returns _id; normalise to id so components don't need to care.
function normalizeItem(item) {
  if (!item) return item
  const { _id, ...rest } = item
  return { ...rest, id: String(_id ?? rest.id) }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function loginWithBackend(idToken) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  })
}

// ── User ──────────────────────────────────────────────────────────────────────

export async function getMe() {
  return request('/api/user/me')
}

export async function addToWatchlist(contentId) {
  return request(`/api/user/watchlist/${contentId}`, { method: 'POST' })
}

export async function removeFromWatchlist(contentId) {
  return request(`/api/user/watchlist/${contentId}`, { method: 'DELETE' })
}

// ── Content ───────────────────────────────────────────────────────────────────

export async function fetchContent(params = {}) {
  const qs = new URLSearchParams(params).toString()
  const data = await request(`/api/content${qs ? `?${qs}` : ''}`)
  return data.map(normalizeItem)
}

export async function fetchFeaturedContent() {
  const item = await request('/api/content/featured')
  return normalizeItem(item)
}

export async function fetchContentById(id) {
  const item = await request(`/api/content/${id}`)
  return normalizeItem(item)
}

export async function fetchStreamUrl(contentId) {
  return request(`/api/content/${contentId}/stream`)
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchContent(q) {
  const data = await request(`/api/search?q=${encodeURIComponent(q)}`)
  return data.map(normalizeItem)
}

// ── Payments ──────────────────────────────────────────────────────────────────

export async function createOrder(plan) {
  return request('/api/payments/create-order', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  })
}

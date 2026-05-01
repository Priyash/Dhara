import { auth } from '../lib/firebase.js'
import { signOut as firebaseSignOut } from 'firebase/auth'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request(path, options = {}) {
  const hadAuthenticatedUser = Boolean(auth.currentUser)
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeaders()),
    ...options.headers,
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    // If a protected request fails with 401 while a user is logged in,
    // force a local sign out and send the app back to home.
    if (res.status === 401 && hadAuthenticatedUser) {
      try {
        await firebaseSignOut(auth)
      } catch { /* no-op */ }
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.location.assign('/')
      }
    }
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
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

export async function likeContent(contentId) {
  return request(`/api/content/${contentId}/like`, { method: 'POST' })
}

export async function dislikeContent(contentId) {
  return request(`/api/content/${contentId}/dislike`, { method: 'POST' })
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

export async function verifyPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature, plan }) {
  return request('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature, plan }),
  })
}

export async function createSubscription(plan) {
  return request('/api/payments/create-subscription', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  })
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function getAdminSession() {
  return request('/api/admin/session')
}

export async function getPaymentConfig() {
  return request('/api/admin/payment-config')
}

export async function updatePaymentConfig(payload) {
  return request('/api/admin/payment-config', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function listAdminCollections() {
  return request('/api/admin/collections')
}

export async function createAdminCollection(payload) {
  return request('/api/admin/collections', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function listAdminContent() {
  return request('/api/admin/content')
}

export async function listUploadJobs(limit = 30) {
  return request(`/api/admin/upload-jobs?limit=${limit}`)
}

export async function createUploadJob(payload) {
  return request('/api/admin/upload-jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function uploadJobFile(jobId, file) {
  const headers = {
    ...(await authHeaders()),
    'Content-Type': 'application/octet-stream',
    'x-file-name': encodeURIComponent(file.name || 'upload.mp4'),
  }

  const res = await fetch(`${BASE_URL}/api/admin/upload-jobs/${jobId}/file`, {
    method: 'PUT',
    headers,
    body: file,
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export async function listBunnyCollections() {
  return request('/api/admin/bunny/collections')
}

export async function createBunnyCollection(name) {
  return request('/api/admin/bunny/collections', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function syncBunnyCollections() {
  return request('/api/admin/bunny/sync-collections', { method: 'POST' })
}

export async function importFromCdn() {
  return request('/api/admin/import-from-cdn', { method: 'POST' })
}

export async function listBunnyVideos(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/admin/bunny/videos${qs ? `?${qs}` : ''}`)
}

export async function mapExistingBunnyVideo(payload) {
  return request('/api/admin/map-existing-video', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchAdminContentById(id) {
  return request(`/api/admin/content/${id}`)
}

export async function updateAdminContent(id, payload) {
  return request(`/api/admin/content/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

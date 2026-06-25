import { auth } from '../lib/firebase.js'
import { signOut as firebaseSignOut } from 'firebase/auth'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const SESSION_KEY = 'dhara:session-id'

function getRecommendationSessionId() {
  if (typeof localStorage === 'undefined') return ''
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

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

export async function fetchWatchlistItems() {
  const data = await request('/api/user/watchlist-items')
  return data.map(normalizeItem)
}

export async function saveWatchProgress(payload) {
  return request('/api/user/watch-progress', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchContinueWatching({ signal } = {}) {
  const data = await request('/api/user/continue-watching', { signal })
  return data.map((item) => {
    const normalized = normalizeItem(item)
    const { positionSecs = 0, durationSecs = 0 } = item._progress || {}

    // Prefer localStorage when it has a higher position — this wins the race
    // between Watch.jsx's unmount flush and Home.jsx's fetch, and also surfaces
    // in-session progress that hasn't been sent to the backend yet.
    const localKey = `dhara_progress_${normalized._id || normalized.id}`
    const localPos = parseFloat(localStorage.getItem(localKey) || '0')
    const localDur = parseFloat(localStorage.getItem(`${localKey}_dur`) || '0')

    const effectivePos = localPos > positionSecs ? localPos : positionSecs
    const effectiveDur = localDur > 0 ? localDur : durationSecs

    const progressPct = effectiveDur > 0
      ? Math.min(99, Math.round((effectivePos / effectiveDur) * 100))
      : 0
    return { ...normalized, progressPct, _progress: { ...item._progress, positionSecs: effectivePos, durationSecs: effectiveDur } }
  })
}

// ── Content ───────────────────────────────────────────────────────────────────

export async function fetchContent(params = {}, { signal } = {}) {
  const qs = new URLSearchParams(
    // strip undefined / null / empty-string values so they don't pollute the query string
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  const data = await request(`/api/content${qs ? `?${qs}` : ''}`, { signal })
  // Paginated response { items, total, page, pages, limit }
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.items)) {
    return { ...data, items: data.items.map(normalizeItem) }
  }
  // Legacy flat array (Home.jsx, no page param)
  return data.map(normalizeItem)
}

export async function fetchContentGenres(params = {}, { signal } = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return request(`/api/content/genres${qs ? `?${qs}` : ''}`, { signal })
}

export async function fetchFeaturedContent() {
  const items = await request('/api/content/featured')
  return Array.isArray(items) ? items.map(normalizeItem) : [normalizeItem(items)]
}

export async function fetchContentById(id) {
  const item = await request(`/api/content/${id}`)
  return normalizeItem(item)
}

export async function fetchTrailerUrl(id) {
  return request(`/api/content/${id}/trailer`)
}

export async function fetchStreamUrl(contentId, episodeNumber = null, seasonNumber = null) {
  const params = new URLSearchParams()
  if (episodeNumber != null) params.set('episode', episodeNumber)
  if (seasonNumber  != null) params.set('season',  seasonNumber)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return request(`/api/content/${contentId}/stream${qs}`)
}

export async function sendStreamHeartbeat(sessionId) {
  return request('/api/content/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
}

export async function endStreamSession(sessionId) {
  return request(`/api/content/stream-session/${sessionId}`, { method: 'DELETE' })
}

export async function likeContent(contentId) {
  const result = await request(`/api/content/${contentId}/like`, { method: 'POST' })
  if (result?.liked) {
    recordInteractionEvent({ itemId: contentId, eventType: 'like', source: 'content_detail' }).catch(() => {})
  }
  return result
}

export async function dislikeContent(contentId) {
  return request(`/api/content/${contentId}/dislike`, { method: 'POST' })
}

export async function rateContent(contentId, score) {
  return request(`/api/content/${contentId}/rate`, {
    method: 'POST',
    body: JSON.stringify({ score }),
  })
}

// ── Recommendations & Interaction Events ─────────────────────────────────────

export async function recordInteractionEvent(payload) {
  return request('/api/recommendations/events', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: getRecommendationSessionId(),
      itemType: 'content',
      ...payload,
    }),
  })
}

export async function fetchRecommendations(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  const data = await request(`/api/recommendations${qs ? `?${qs}` : ''}`, {
    headers: { 'X-Rec-Session': getRecommendationSessionId() },
  })
  return {
    ...data,
    items: Array.isArray(data?.items) ? data.items.map(normalizeItem) : [],
  }
}

export async function fetchRecommendationShelves({ signal } = {}) {
  const data = await request('/api/recommendations/shelves', {
    headers: { 'X-Rec-Session': getRecommendationSessionId() },
    signal,
  })
  return (data.shelves || []).map(shelf => ({
    ...shelf,
    items: Array.isArray(shelf.items) ? shelf.items.map(normalizeItem) : [],
  }))
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchContent(q) {
  const data = await request(`/api/search?q=${encodeURIComponent(q)}`)
  return data.map(normalizeItem)
}

export async function fetchPopularSearches() {
  const data = await request('/api/search/popular')
  return Array.isArray(data) ? data : []
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

export async function verifySubscription({ razorpay_payment_id, razorpay_subscription_id, razorpay_signature, plan }) {
  return request('/api/payments/verify-subscription', {
    method: 'POST',
    body: JSON.stringify({ razorpay_payment_id, razorpay_subscription_id, razorpay_signature, plan }),
  })
}

export async function getPaymentHistory() {
  return request('/api/payments/history')
}

export async function cancelSubscription() {
  return request('/api/payments/cancel', { method: 'POST' })
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

export async function getUploadJob(id) {
  return request(`/api/admin/upload-jobs/${id}`)
}

export async function createUploadJob(payload) {
  return request('/api/admin/upload-jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function uploadJobFile(jobId, file, { onProgress, onXhr } = {}) {
  return new Promise((resolve, reject) => {
    auth.currentUser?.getIdToken()
      .then((token) => {
        const xhr = new XMLHttpRequest()
        if (onXhr) onXhr(xhr)
        if (onProgress) {
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
          })
        }
        xhr.addEventListener('load', () => {
          try {
            const data = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) resolve(data)
            else reject(new Error(data?.error || `HTTP ${xhr.status}`))
          } catch { reject(new Error(`HTTP ${xhr.status}`)) }
        })
        xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
        xhr.open('PUT', `${BASE_URL}/api/admin/upload-jobs/${jobId}/file`)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name || 'upload.mp4'))
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.send(file)
      })
      .catch(reject)
  })
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

export async function syncCdnDeletions() {
  return request('/api/admin/bunny/sync-deletions', { method: 'POST' })
}

export async function searchArchive(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return request(`/api/admin/archive/search${qs ? `?${qs}` : ''}`)
}

export async function importFromArchive(items, allowUnlicensed = false) {
  return request('/api/admin/archive/import', {
    method: 'POST',
    body: JSON.stringify({ items, allowUnlicensed }),
  })
}

export async function cancelUploadJob(id) {
  return request(`/api/admin/upload-jobs/${id}/cancel`, { method: 'PATCH' })
}

export async function retryUploadJob(id) {
  return request(`/api/admin/upload-jobs/${id}/retry`, { method: 'PATCH' })
}

export async function listArchiveTasks() {
  return request('/api/admin/archive/tasks')
}

export async function listArchiveCandidates(status = 'new') {
  return request(`/api/admin/archive/candidates?status=${encodeURIComponent(status)}`)
}

export async function dismissArchiveCandidate(id) {
  return request(`/api/admin/archive/candidates/${id}/dismiss`, { method: 'PATCH' })
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

export async function createAdminContent(payload) {
  return request('/api/admin/content', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateAdminContent(id, payload) {
  return request(`/api/admin/content/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function togglePublishContent(id, publish) {
  return request(`/api/admin/content/${id}/publish`, {
    method: 'PATCH',
    body: JSON.stringify({ publish }),
  })
}

export async function deleteAdminContent(id) {
  return request(`/api/admin/content/${id}`, { method: 'DELETE' })
}

export async function getAdminTransactions(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/admin/transactions${qs ? `?${qs}` : ''}`)
}

export async function getAdminRevenue() {
  return request('/api/admin/revenue')
}

export async function getAdminMonitor() {
  return request('/api/admin/monitor')
}

export async function listAdminCreatorEarnings(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/admin/creator-earnings${qs ? `?${qs}` : ''}`)
}

export async function calculateCreatorEarnings(payload) {
  return request('/api/admin/revenue/calculate', { method: 'POST', body: JSON.stringify(payload) })
}

export async function processCreatorPayout(payload) {
  return request('/api/admin/creator-payouts', { method: 'POST', body: JSON.stringify(payload) })
}

export async function listAdminCreatorPayouts() {
  return request('/api/admin/creator-payouts')
}

// ── Creator Studio ────────────────────────────────────────────────────────────

export async function applyAsCreator(payload) {
  return request('/api/creator/apply', { method: 'POST', body: JSON.stringify(payload) })
}

export async function getCreatorStatus() {
  return request('/api/creator/status')
}

export async function getCreatorMe() {
  return request('/api/creator/me')
}

export async function updateCreatorProfile(payload) {
  return request('/api/creator/profile', { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function listCreatorContent(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/creator/content${qs ? `?${qs}` : ''}`)
}

export async function createCreatorContent(payload) {
  return request('/api/creator/content', { method: 'POST', body: JSON.stringify(payload) })
}

export async function getCreatorContentById(id) {
  return request(`/api/creator/content/${id}`)
}

export async function updateCreatorContent(id, payload) {
  return request(`/api/creator/content/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function resubmitCreatorContent(id) {
  return request(`/api/creator/content/${id}/resubmit`, { method: 'POST' })
}

export async function deleteCreatorContent(id) {
  return request(`/api/creator/content/${id}`, { method: 'DELETE' })
}

export async function getCreatorAnalytics() {
  return request('/api/creator/analytics')
}

export async function getCreatorRevenue() {
  return request('/api/creator/revenue')
}

export async function requestCreatorPayout(payload = {}) {
  return request('/api/creator/payouts/request', { method: 'POST', body: JSON.stringify(payload) })
}

export async function recordView(id, episodeNumber = null, positionSecs = 30, seasonNumber = null) {
  return request(`/api/content/${id}/view`, {
    method: 'POST',
    body: JSON.stringify({
      positionSecs,
      ...(episodeNumber != null ? { episodeNumber } : {}),
      ...(seasonNumber  != null ? { seasonNumber  } : {}),
    }),
  })
}

// ── Reels ─────────────────────────────────────────────────────────────────────

export async function searchReels(q) {
  const data = await request(`/api/reels/search?q=${encodeURIComponent(q)}`)
  return Array.isArray(data) ? data : []
}

export async function fetchReelHashtags(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  const data = await request(`/api/reels/hashtags${qs ? `?${qs}` : ''}`)
  return Array.isArray(data) ? data : []
}

export async function fetchReels(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return request(`/api/reels${qs ? `?${qs}` : ''}`)
}

export async function fetchReelById(id) {
  return request(`/api/reels/${id}`)
}

export async function fetchReelStreamUrl(id) {
  return request(`/api/reels/${id}/stream`)
}

export async function recordReelView(id, positionSecs = 5) {
  return request(`/api/reels/${id}/view`, {
    method: 'POST',
    body:   JSON.stringify({ positionSecs }),
  })
}

export async function likeReel(id) {
  const result = await request(`/api/reels/${id}/like`, { method: 'POST' })
  if (result?.liked) {
    recordInteractionEvent({ itemType: 'reel', itemId: id, eventType: 'like', source: 'reels' }).catch(() => {})
  }
  return result
}

export async function fetchReelComments(id, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return request(`/api/reels/${id}/comments${qs ? `?${qs}` : ''}`)
}

export async function postReelComment(id, text) {
  return request(`/api/reels/${id}/comments`, {
    method: 'POST',
    body:   JSON.stringify({ text }),
  })
}

export async function deleteReelComment(reelId, commentId) {
  return request(`/api/reels/${reelId}/comments/${commentId}`, { method: 'DELETE' })
}

export async function createReelUploadJob(reelId) {
  return request(`/api/reels/${reelId}/upload-job`, { method: 'POST' })
}

export async function getReelUploadJob(reelId) {
  return request(`/api/reels/${reelId}/upload-job`)
}

// XHR-based so callers can track upload progress via onProgress(0–100).
export function uploadReelFile(reelId, file, { onProgress, onXhr } = {}) {
  return new Promise((resolve, reject) => {
    auth.currentUser?.getIdToken()
      .then((token) => {
        const xhr = new XMLHttpRequest()
        if (onXhr) onXhr(xhr)
        if (onProgress) {
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
          })
        }
        xhr.addEventListener('load', () => {
          try {
            const data = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) resolve(data)
            else reject(new Error(data?.error || `HTTP ${xhr.status}`))
          } catch { reject(new Error(`HTTP ${xhr.status}`)) }
        })
        xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
        xhr.open('PUT', `${BASE_URL}/api/reels/${reelId}/file`)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name || 'reel.mp4'))
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.send(file)
      })
      .catch(reject)
  })
}

// ── Creator reel management ───────────────────────────────────────────────────

export async function fetchReelAnalytics() {
  return request('/api/creator/reels/analytics')
}

export async function listCreatorReels(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return request(`/api/creator/reels${qs ? `?${qs}` : ''}`)
}

export async function createCreatorReel(payload) {
  return request('/api/creator/reels', { method: 'POST', body: JSON.stringify(payload) })
}

export async function deleteCreatorReel(id) {
  return request(`/api/creator/reels/${id}`, { method: 'DELETE' })
}

export async function resubmitCreatorReel(id) {
  return request(`/api/creator/reels/${id}/resubmit`, { method: 'POST' })
}

// ── Admin Creator Hub ─────────────────────────────────────────────────────────

export async function listCreatorApplications(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/admin/creator-applications${qs ? `?${qs}` : ''}`)
}

export async function approveCreatorApplication(userId) {
  return request(`/api/admin/creator-applications/${userId}/approve`, { method: 'PATCH' })
}

export async function rejectCreatorApplication(userId, reason) {
  return request(`/api/admin/creator-applications/${userId}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ reason }),
  })
}

export async function listAdminSubmissions(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/admin/submissions${qs ? `?${qs}` : ''}`)
}

export async function approveSubmission(id) {
  return request(`/api/admin/submissions/${id}/approve`, { method: 'PATCH' })
}

export async function rejectSubmission(id, reason) {
  return request(`/api/admin/submissions/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ reason }),
  })
}

// ── Curated Shelves (public) ──────────────────────────────────────────────────

export async function fetchShelves({ signal } = {}) {
  const shelves = await request('/api/content/shelves', { signal })
  // Normalize _id → id on populated items so PosterCard / navigation work correctly
  return shelves.map((s) => ({
    ...s,
    id: String(s._id),
    items: (s.items || []).map(normalizeItem),
  }))
}

// ── Curated Shelves (admin) ───────────────────────────────────────────────────

export async function listAdminShelves() {
  return request('/api/admin/shelves')
}

export async function createAdminShelf(payload) {
  return request('/api/admin/shelves', { method: 'POST', body: JSON.stringify(payload) })
}

export async function updateAdminShelf(id, payload) {
  return request(`/api/admin/shelves/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function deleteAdminShelf(id) {
  return request(`/api/admin/shelves/${id}`, { method: 'DELETE' })
}

export async function reorderAdminShelves(order) {
  return request('/api/admin/shelves/reorder', { method: 'PATCH', body: JSON.stringify({ order }) })
}

// ── Admin Reels ───────────────────────────────────────────────────────────────

export async function listAdminReels(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return request(`/api/admin/reels${qs ? `?${qs}` : ''}`)
}

export async function approveAdminReel(id) {
  return request(`/api/admin/reels/${id}/approve`, { method: 'PATCH' })
}

export async function rejectAdminReel(id, reason) {
  return request(`/api/admin/reels/${id}/reject`, {
    method: 'PATCH',
    body:   JSON.stringify({ reason }),
  })
}

export async function deleteAdminReel(id) {
  return request(`/api/admin/reels/${id}`, { method: 'DELETE' })
}

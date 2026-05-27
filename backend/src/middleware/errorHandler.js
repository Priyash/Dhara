// Mongoose / MongoDB driver error names that indicate a transient connectivity issue.
// These should return 503 (retryable) rather than 500 (permanent failure).
const MONGO_NETWORK_ERRORS = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoTopologyClosedError',
  'MongoNotConnectedError',
])

function codeFromStatus(status) {
  if (status === 429) return 'RATE_LIMITED'
  if (status === 503) return 'SERVICE_UNAVAILABLE'
  if (status === 502 || status === 504) return 'GATEWAY_ERROR'
  if (status >= 500) return 'INTERNAL_ERROR'
  if (status === 404) return 'NOT_FOUND'
  if (status === 403) return 'FORBIDDEN'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 400) return 'BAD_REQUEST'
  if (status === 409) return 'CONFLICT'
  return 'REQUEST_ERROR'
}

// Optional external error reporter. Wire up Sentry or any other monitoring
// tool by setting ERROR_REPORTING_HOOK to a JS file path that exports a
// default `report(err, context)` function. Zero-dependency in the default setup.
let _reporter = null
async function loadReporter() {
  const hook = process.env.ERROR_REPORTING_HOOK
  if (!hook) return
  try {
    const mod = await import(hook)
    _reporter = mod.default ?? mod.report ?? null
    if (_reporter) console.log('[errorHandler] external reporter loaded from', hook)
  } catch (e) {
    console.warn('[errorHandler] could not load reporter hook:', e.message)
  }
}
loadReporter()

export function errorHandler(err, req, res, _next) {
  const isDbError = MONGO_NETWORK_ERRORS.has(err.name) || err.name?.startsWith('Mongo')
  const status    = isDbError ? 503 : (err.status || err.statusCode || 500)
  const code      = isDbError ? 'SERVICE_UNAVAILABLE' : (err.code || codeFromStatus(status))
  const isProd    = process.env.NODE_ENV === 'production'
  const requestId = req.id ?? '-'

  if (status >= 500) {
    if (isProd) {
      // Structured JSON — parseable by Datadog, CloudWatch, Render log drains, etc.
      console.error(JSON.stringify({
        level: 'error',
        ts:    new Date().toISOString(),
        requestId,
        method: req.method,
        path:   req.path,
        status,
        code,
        error:  err.message,
        stack:  err.stack,
      }))
    } else {
      console.error(`[${req.method}] ${req.path} (${requestId}) —`, err.stack ?? err.message)
    }

    // Fire-and-forget to external reporter — must never throw or block the response
    if (_reporter) {
      try { _reporter(err, { requestId, method: req.method, path: req.path, status }) }
      catch { /* swallow */ }
    }
  } else {
    // 4xx are expected — brief warn, no stack
    console.warn(`[${req.method}] ${req.path} ${status} (${requestId}) — ${err.message}`)
  }

  const message = (isProd && status >= 500)
    ? 'Service temporarily unavailable. Please try again in a moment.'
    : err.message

  res.status(status).json({ error: message, code })
}

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

export function errorHandler(err, req, res, _next) {
  // Reclassify Mongoose network/connectivity errors as 503 so clients know to retry
  const isDbError = MONGO_NETWORK_ERRORS.has(err.name) || err.name?.startsWith('Mongo')
  const status    = isDbError
    ? 503
    : (err.status || err.statusCode || 500)

  console.error(`[${req.method}] ${req.path} —`, err.message)

  const code    = isDbError ? 'SERVICE_UNAVAILABLE' : (err.code || codeFromStatus(status))
  const message = (process.env.NODE_ENV === 'production' && status >= 500)
    ? 'Service temporarily unavailable. Please try again in a moment.'
    : err.message

  res.status(status).json({ error: message, code })
}

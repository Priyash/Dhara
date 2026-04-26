export function errorHandler(err, req, res, _next) {
  console.error(`[${req.method}] ${req.path} —`, err.message)
  const status = err.status || err.statusCode || 500
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
  })
}

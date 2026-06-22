/**
 * Optional Sentry integration for errorHandler.js's ERROR_REPORTING_HOOK.
 *
 * To enable:
 *   1. Set SENTRY_DSN to your project's DSN (sentry.io → Settings → Client Keys)
 *   2. Set ERROR_REPORTING_HOOK=../integrations/sentryReporter.js
 *      (relative to src/middleware/errorHandler.js, which loads this hook)
 *
 * With SENTRY_DSN unset, this module stays inert — safe to leave wired in
 * without configuring it.
 */
import * as Sentry from '@sentry/node'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment:      process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,   // error tracking only — no perf tracing by default
  })
}

export default function report(err, context) {
  if (!dsn) return
  Sentry.captureException(err, { extra: context })
}

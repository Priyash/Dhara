/**
 * Profile-based env loader.
 *
 * Selects the right secrets file based on APP_PROFILE:
 *   dev      → config/secrets/dev/.env.dev
 *   staging  → config/secrets/staging/.env.staging
 *   prod     → config/secrets/prod/.env.prod
 *
 * On Render (production), APP_PROFILE=prod is set as a dashboard env var.
 * If no file exists (e.g. on Render where secrets are injected directly),
 * this module does nothing — process.env already contains the right values.
 *
 * Import this as the FIRST statement in server.js before any other imports
 * that read from process.env.
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const VALID_PROFILES = ['dev', 'staging', 'prod']

const profile = process.env.APP_PROFILE
  || (process.env.NODE_ENV === 'production' ? 'prod' : 'dev')

if (!VALID_PROFILES.includes(profile)) {
  console.warn(`[env] Unknown profile "${profile}". Expected: dev | staging | prod.`)
}

const envFile = path.resolve(
  __dirname,
  `../../../config/secrets/${profile}/.env.${profile}`
)

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile })
  console.log(`[env] Loaded profile "${profile}" ← ${envFile}`)
} else {
  // Normal on Render/cloud — env vars are injected by the platform
  console.log(`[env] Profile "${profile}" — using platform-injected environment (no file found at ${envFile})`)
}

export const PROFILE = profile

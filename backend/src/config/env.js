/**
 * Profile-based env loader with template + vault resolution.
 *
 * Lookup order:
 *   1. .env.{profile}.template  (committed)  — structure + safe literal defaults
 *      + .secrets.{profile}     (gitignored)  — real KEY=value pairs
 *      → resolves ${PLACEHOLDER} → injects into process.env
 *
 *   2. No template found (Render / cloud) — process.env already populated
 *      by the platform; this module does nothing.
 *
 * Import this as the FIRST statement in server.js before anything reads process.env.
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

const secretsDir = path.resolve(__dirname, `../../../config/secrets/${profile}`)
const envFile    = path.join(secretsDir, `.env.${profile}`)
const vaultFile  = path.join(secretsDir, `.secrets.${profile}`)

/** Parse a KEY=value file into a plain object. Splits on the first '=' only. */
function parseKeyValueFile(content) {
  const map = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
  }
  return map
}

if (fs.existsSync(envFile)) {
  const vault = fs.existsSync(vaultFile)
    ? parseKeyValueFile(fs.readFileSync(vaultFile, 'utf8'))
    : {}

  if (fs.existsSync(vaultFile)) {
    console.log(`[env] Vault loaded for profile "${profile}"`)
  } else {
    console.log(`[env] Profile "${profile}" — no vault file, resolving placeholders from platform env`)
  }

  const template = fs.readFileSync(envFile, 'utf8')

  const resolved = template.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const value = vault[key] ?? process.env[key]
    if (value === undefined) {
      console.warn(`[env] Unresolved placeholder: ${match}`)
      return ''
    }
    return value
  })

  const parsed = dotenv.parse(resolved)
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value
  }

  console.log(`[env] Loaded profile "${profile}" ← ${envFile}`)
} else {
  console.log(`[env] Profile "${profile}" — using platform-injected environment (no file at ${envFile})`)
}

export const PROFILE = profile

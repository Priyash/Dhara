import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

export default defineConfig(({ mode }) => {
  /**
   * Profile resolution order:
   *  1. APP_PROFILE env var  (set in shell or CI)
   *  2. Vite --mode flag     (dev | staging | prod)
   *  3. default → 'dev'
   *
   * Vite maps its default modes: 'development' → 'dev', 'production' → 'prod'
   */
  const modeMap = { development: 'dev', production: 'prod' }
  const profile = process.env.APP_PROFILE || modeMap[mode] || mode

  const secretsDir = path.resolve(__dirname, `../config/secrets/${profile}`)
  const envFile    = path.join(secretsDir, `.env.${profile}`)
  const vaultFile  = path.join(secretsDir, `.secrets.${profile}`)

  if (fs.existsSync(envFile)) {
    // Parse vault file (local dev); fall back to process.env when absent (Vercel build)
    const vault = {}
    if (fs.existsSync(vaultFile)) {
      for (const line of fs.readFileSync(vaultFile, 'utf8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        vault[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
      }
    }

    const template = fs.readFileSync(envFile, 'utf8')
    const resolved = template.replace(/\$\{([^}]+)\}/g, (match, key) => {
      const value = vault[key] ?? process.env[key]
      return value !== undefined ? value : ''
    })

    // Inject all resolved vars into process.env.
    // Vite's internal loadEnv picks up VITE_* from process.env automatically.
    for (const line of resolved.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1)
      if (!(key in process.env)) process.env[key] = value
    }
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    build: {
      // Target modern browsers — enables smaller output by skipping legacy transforms
      target: 'es2020',
      // Raise the warning threshold slightly; our chunking keeps individual chunks small
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            // React runtime — tiny, cached forever
            'react-core':    ['react', 'react-dom', 'react-router-dom'],
            // Icon library is large (~800 KB raw) — separate so it's cached independently
            'icons':         ['lucide-react'],
            // HLS player — only needed on /watch
            'hls':           ['hls.js'],
            // Firebase SDK — large, rarely changes
            'firebase':      ['firebase/app', 'firebase/auth'],
            // State management
            'zustand':       ['zustand'],
          },
        },
      },
    },

    // No envDir — resolved VITE_* vars are in process.env; Vite picks them up via loadEnv.
    // On Vercel, the platform injects them directly into process.env before build.
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/__tests__/setup.js'],
    },
  }
})

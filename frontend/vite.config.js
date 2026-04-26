import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { existsSync } from 'fs'

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

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    /**
     * Point Vite at the profile's secrets folder so it loads .env.{profile}.
     * On Vercel, this directory won't exist — Vercel injects VITE_ vars directly
     * into process.env at build time, which Vite picks up automatically.
     */
    ...(existsSync(secretsDir) ? { envDir: secretsDir } : {}),
  }
})

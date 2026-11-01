import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Phase 13 WI-3 — run the web app locally against the cloud backend by
  // setting WINE_API_TARGET (e.g. https://<app>.fly.dev) and WINE_ACCESS_KEY
  // in the repo-root .env. Both are read here, in Node, and only the proxy
  // uses them: neither has the VITE_ prefix, so neither reaches the bundle.
  // Unset, /api goes to the local backend as before.
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const target = env.WINE_API_TARGET || 'http://localhost:3000'
  const headers: Record<string, string> = env.WINE_ACCESS_KEY ? { Authorization: `Bearer ${env.WINE_ACCESS_KEY}` } : {}

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      proxy: {
        '/api': { target, changeOrigin: true, headers },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.ts',
      include: ['src/**/*.test.{ts,tsx}'],
      root: '.',
    },
  }
})

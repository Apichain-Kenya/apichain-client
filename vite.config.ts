/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The manifest feeds scripts/bundle-report.mjs, the D13 budget gate.
  build: { manifest: true },
  // Same-origin in dev too (12 D4): the refresh cookie is SameSite=Strict and
  // scoped to /v2/auth, so the API must be reached through this origin.
  server: { proxy: { '/v2': 'http://localhost:8000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Process CSS so `tokens.css?raw` is the real file in tokens.test.ts.
    css: true,
  },
})

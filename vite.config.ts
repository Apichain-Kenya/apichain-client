/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The installable PWA (12 §9). injectManifest: the worker is our own
    // src/sw/sw.ts; the plugin only builds it and injects the precache list.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        // The farmer app's own chunk is precached, so offline capture survives
        // an app update (the new shell must find its farm chunk with no
        // network; review). Only the online-only map (Leaflet) and the QR
        // fallback stay out: about 16 KB gzip for shoppers instead of ~60.
        // The console's own chunk is precached too (about 6 KB gzip): with
        // `prompt` updates, an old shell must still find its matching console
        // after a deploy has removed the old hashed files. Heavy lazy chunks
        // (map, QR) stay out.
        globIgnores: ['**/assets/farm-MapPicker*', '**/assets/qr-scanner*'],
      },
      manifest: {
        name: 'ApiChain',
        short_name: 'ApiChain',
        description: 'Check where your honey came from, and record harvests offline.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f3f4ee',
        theme_color: '#f3f4ee',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // The manifest feeds scripts/bundle-report.mjs, the D13 budget gate.
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        // Name every farmer chunk farm-* and console chunk console-*, so the
        // precache can leave out what it must. The chunk the capture app and
        // the console share, holding the session and the outbox (13 §7 step
        // 2), is named `session` so bundle-report can prove the jar page
        // never loads it. The bundler draws that chunk itself: forcing it
        // with manualChunks pulled shared code into it, and the entry with it.
        chunkFileNames: (chunk) =>
          chunk.facadeModuleId?.includes('/src/farm/')
            ? 'assets/farm-[name]-[hash].js'
            : chunk.facadeModuleId?.includes('/src/console/')
              ? 'assets/console-[name]-[hash].js'
              : chunk.moduleIds.some((id) => id.endsWith('/src/auth/session.ts'))
                ? 'assets/session-[hash].js'
                : 'assets/[name]-[hash].js',
        // Their CSS too (FarmApp, MapPicker incl. Leaflet's stylesheet).
        assetFileNames: (asset) =>
          asset.names?.some((n) => /^(FarmApp|MapPicker)\./.test(n))
            ? 'assets/farm-[name]-[hash][extname]'
            : asset.names?.some((n) => /^ConsoleApp\./.test(n))
              ? 'assets/console-[name]-[hash][extname]'
              : 'assets/[name]-[hash][extname]',
      },
    },
  },
  // Same-origin in dev too (12 D4): the refresh cookie is SameSite=Strict and
  // scoped to /v2/auth, so the API must be reached through this origin.
  server: { proxy: { '/v2': 'http://localhost:8000' } },
  // `npm run preview` serves the built PWA (service worker included) the same way.
  preview: { proxy: { '/v2': 'http://localhost:8000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Whole-flow UI tests (userEvent typing, fake IndexedDB) are slow under
    // parallel load; on a small machine or CI runner the 5 s default flaked.
    testTimeout: 15_000,
    maxWorkers: 2,
    // Process CSS so `tokens.css?raw` is the real file in tokens.test.ts.
    css: true,
  },
})

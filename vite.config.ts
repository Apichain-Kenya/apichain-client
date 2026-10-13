/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The installable PWA (12 �9). injectManifest: the worker is our own
    // src/sw/sw.ts; the plugin only builds it and injects the precache list.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        // Shoppers never download the farmer app or the QR fallback up front
        // (03 §4 data cost); those are cached on first use (src/sw/rules.ts).
        globIgnores: ['**/assets/farm-*', '**/assets/qr-scanner*'],
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
        // Name every farmer chunk farm-*, so the precache can leave it out.
        chunkFileNames: (chunk) =>
          chunk.facadeModuleId?.includes('/src/farm/')
            ? 'assets/farm-[name]-[hash].js'
            : 'assets/[name]-[hash].js',
        // Their CSS too (FarmApp, MapPicker incl. Leaflet's stylesheet).
        assetFileNames: (asset) =>
          asset.names?.some((n) => /^(FarmApp|MapPicker)\./.test(n))
            ? 'assets/farm-[name]-[hash][extname]'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
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

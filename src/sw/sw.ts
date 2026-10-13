/// <reference lib="webworker" />
// The service worker (12 §9). Our own small file, built by vite-plugin-pwa in
// injectManifest mode, so what it does is reviewable here rather than
// generated.
import { ExpirationPlugin } from 'workbox-expiration'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'

import { isAppChunk, isCacheableVerify, markCachedFallback, stampStored } from './rules'

declare const self: ServiceWorkerGlobalScope

// App shell, route chunks, fonts and strings: available offline after the
// first visit, and on repeat visits without spending data.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Any app URL opened offline gets the shell; the router takes it from there.
// The API is never answered with the shell.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/v2\//] }),
)

// The one runtime cache: the anonymous jar check. Network first, so an
// online re-scan always shows the live result; the cache answers only when
// the network fails or takes over 4 s, and marks itself (D15).
registerRoute(
  ({ url, request }) =>
    isCacheableVerify({
      url,
      method: request.method,
      sameOrigin: url.origin === self.location.origin,
    }),
  new NetworkFirst({
    cacheName: 'jar-checks',
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 3600 }),
      {
        cacheWillUpdate: async ({ response }) =>
          response.ok ? stampStored(response, Date.now()) : null,
        cachedResponseWillBeUsed: async ({ cachedResponse }) =>
          cachedResponse ? markCachedFallback(cachedResponse) : null,
      },
    ],
  }),
)

// Build chunks not in the precache (the farmer app, the QR fallback): cached
// on first use. Hashed names never change, so cache-first is safe.
registerRoute(
  ({ url, request }) =>
    isAppChunk({ url, method: request.method, sameOrigin: url.origin === self.location.origin }),
  new CacheFirst({
    cacheName: 'app-chunks',
    plugins: [new ExpirationPlugin({ maxEntries: 80, purgeOnQuotaError: true })],
  }),
)

// The page asks before a new version takes over, so nothing reloads in the
// middle of a form (12 §9).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

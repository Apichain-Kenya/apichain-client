// The precache manifest vite-plugin-pwa injects at build time.
declare interface ServiceWorkerGlobalScope {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

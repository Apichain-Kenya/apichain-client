import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True on a laptop-width screen (12 §4.5). False where it cannot be known. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches,
    () => false,
  )
}

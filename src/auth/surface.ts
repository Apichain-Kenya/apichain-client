import type { Me } from './SessionContext'

// Which app a person signs in to (13 §7 step 2): a farmer to the capture app,
// everyone else to the console. A `next` is honoured only inside that app,
// so a staff link can never land a farmer in the console's sign-in loop, and
// `/farmfoo` is not `/farm`.
export function surfaceFor(role: Me['role']): '/farm' | '/console' {
  return role === 'farmer' ? '/farm' : '/console'
}

export function landingFor(role: Me['role'], next: string | null): string {
  const surface = surfaceFor(role)
  if (!next) return surface
  const inside =
    next === surface || next.startsWith(`${surface}/`) || next.startsWith(`${surface}?`)
  return inside ? next : surface
}

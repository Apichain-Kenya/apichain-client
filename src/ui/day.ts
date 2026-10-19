/**
 * A declared day (13 §0 #10) as YYYY-MM-DD: the first ten characters of the
 * field the person entered, never a Date round-trip. The backend sends it as
 * naive UTC midnight, which a local parse turns into the day before west of
 * UTC. Null when the value is not a date.
 */
export function dayOf(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

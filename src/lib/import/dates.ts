// Tiny ISO-date helpers (YYYY-MM-DD). Calendar maths in UTC so no DST/TZ drift.

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole days from a to b (b - a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000)
}

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Today's date in Perth as YYYY-MM-DD. */
export function perthToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(now)
}

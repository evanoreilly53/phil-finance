// Display labels for insights (client-safe: no engine imports).

/** "deposit ~12 days sooner", "deposit ~3 months later", "about the same deposit date". */
export function depositDaysLabel(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null
  const a = Math.abs(days)
  if (a < 1) return 'about the same deposit date'
  const when = days > 0 ? 'sooner' : 'later'
  if (a < 60) return `deposit ~${a} day${a === 1 ? '' : 's'} ${when}`
  return `deposit ~${Math.round(a / 30.4)} months ${when}`
}

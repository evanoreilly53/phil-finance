// ── Currency ──────────────────────────────────────────────────────────────────

export function fmtAUD(cents: number, opts?: { full?: boolean; signed?: boolean }): string {
  const abs = Math.abs(cents) / 100
  const sign = opts?.signed ? (cents < 0 ? '-' : '+') : ''
  const formatted = abs.toLocaleString('en-AU', {
    minimumFractionDigits: opts?.full ? 2 : 0,
    maximumFractionDigits: opts?.full ? 2 : 0,
  })
  return `${sign}$${formatted}`
}

export function fmtCompact(cents: number): string {
  const n = Math.abs(cents) / 100
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return '$' + Math.round(n / 1_000) + 'k'
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })
}

export function fmtEUR(cents: number): string {
  return '€' + Math.abs(cents / 100).toLocaleString('en-IE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ── Dates ─────────────────────────────────────────────────────────────────────

export function fmtDate(
  dateStr: string,
  fmt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', fmt)
}

// ── Month keys ────────────────────────────────────────────────────────────────

export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

export function monthLabel(key: string, fmt?: Intl.DateTimeFormatOptions): string {
  if (!key) return '—'
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(
    'en-AU',
    fmt ?? { month: 'long', year: 'numeric' },
  )
}

export function perthMonthKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Perth',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year  = parts.find(p => p.type === 'year')!.value
  const month = parts.find(p => p.type === 'month')!.value
  return `${year}-${month}`
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

export function daysUntilPerth(dateStr: string): number {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Perth',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y   = parts.find(p => p.type === 'year')!.value
  const mo  = parts.find(p => p.type === 'month')!.value
  const day = parts.find(p => p.type === 'day')!.value
  const today  = new Date(`${y}-${mo}-${day}T00:00:00`)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// ── Delta ─────────────────────────────────────────────────────────────────────

export function signedDelta(cents: number): { sign: '+' | '-'; text: string; isPositive: boolean } {
  return {
    sign:       cents >= 0 ? '+' : '-',
    text:       fmtAUD(Math.abs(cents)),
    isPositive: cents >= 0,
  }
}

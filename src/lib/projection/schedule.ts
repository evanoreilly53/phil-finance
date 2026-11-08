// Calendar helpers for the projection: month arithmetic and how many times a
// recurring item falls in a month. Pure; dates are ISO strings, maths in UTC.

import type { Frequency } from './types'

export function monthStart(mk: string): string {
  return `${mk}-01`
}

export function daysInMonth(mk: string): number {
  const [y, m] = mk.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function monthEnd(mk: string): string {
  return `${mk}-${String(daysInMonth(mk)).padStart(2, '0')}`
}

/** Whole months from a to b (b − a), on YYYY-MM keys. */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

export function addMonthsKey(mk: string, n: number): string {
  const [y, m] = mk.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const DAY = 86_400_000
const STEP_MONTHS: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, annual: 12 }
const STEP_DAYS: Partial<Record<Frequency, number>> = { weekly: 7, fortnightly: 14 }

export const OCCURRENCES_PER_YEAR: Record<Exclude<Frequency, 'once'>, number> = {
  weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, annual: 1,
}

/**
 * Dates on which an item falls inside month `mk`, between its start and end.
 * Monthly/quarterly/annual items keep the start date's day, clamped to the
 * month's last day (a 31st-of-the-month bill lands on 28/29 Feb, 30 Apr...).
 */
export function occurrencesInMonth(
  item: { frequency: Frequency; startDate: string; endDate: string | null },
  mk: string,
): string[] {
  const from = monthStart(mk)
  const to = monthEnd(mk)
  const end = item.endDate && item.endDate < to ? item.endDate : to
  if (item.startDate > end) return []

  if (item.frequency === 'once') {
    return item.startDate >= from && item.startDate <= end ? [item.startDate] : []
  }

  const stepM = STEP_MONTHS[item.frequency]
  if (stepM) {
    const diff = monthDiff(item.startDate.slice(0, 7), mk)
    if (diff < 0 || diff % stepM !== 0) return []
    const day = Math.min(Number(item.startDate.slice(8, 10)), daysInMonth(mk))
    const d = `${mk}-${String(day).padStart(2, '0')}`
    return d >= item.startDate && d <= end ? [d] : []
  }

  const stepD = STEP_DAYS[item.frequency]!
  const s = utc(item.startDate)
  const k0 = Math.max(0, Math.ceil((utc(from) - s) / (stepD * DAY)))
  const out: string[] = []
  for (let k = k0; ; k++) {
    const d = iso(s + k * stepD * DAY)
    if (d > end) break
    if (d >= from) out.push(d)
  }
  return out
}

// Super concessional cap tracker, per person, for the current FY. Pure.
// SG comes from the gross salary via the Phase 2 take-home engine; voluntary
// concessional contributions are planned_cashflows rows (kind
// super_contribution, source_table 'super_concessional') entered on
// Track › Income. Carry-forward of unused cap from earlier years isn't modelled.

import { annualTakeHome } from './tax/takeHome'
import { fyOf, type FyKey } from './tax/config'
import { occurrencesInMonth, addMonthsKey } from './projection/schedule'
import { dayDiff } from './import/dates'
import type { Frequency } from './projection/types'

export const CONCESSIONAL_SOURCE = 'super_concessional'

export type ConcessionalRow = {
  id: string
  person_key: string | null
  amount_cents: number
  frequency: Frequency
  start_date: string
  end_date: string | null
  status: 'planned' | 'paid' | 'cancelled'
  description: string
}

/** First and last day of the FY containing `date`. */
export function fyBounds(date: string): { fy: FyKey; start: string; end: string } {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7))
  const startYear = m >= 7 ? y : y - 1
  return { fy: fyOf(date), start: `${startYear}-07-01`, end: `${startYear + 1}-06-30` }
}

/** Contributions (paid or planned, not cancelled) falling inside the FY of `today`, per row. */
export function contributionsInFy(rows: readonly ConcessionalRow[], personKey: string, today: string): { row: ConcessionalRow; dates: string[]; cents: number }[] {
  const { start, end } = fyBounds(today)
  const months = Array.from({ length: 12 }, (_, i) => addMonthsKey(start.slice(0, 7), i))
  return rows.filter(r => r.person_key === personKey && r.status !== 'cancelled').map(r => {
    const item = { frequency: r.frequency, startDate: r.start_date, endDate: r.end_date }
    const dates = months.flatMap(mk => occurrencesInMonth(item, mk)).filter(d => d >= start && d <= end)
    return { row: r, dates, cents: Math.abs(r.amount_cents) * dates.length }
  }).filter(x => x.dates.length > 0)
}

export type CapLine = {
  personKey: string
  name: string
  fy: FyKey
  grossCents: number
  sgCents: number
  voluntaryCents: number
  /** Salary sacrifice from Assumptions still to come this FY (Phase 5). */
  plannedCents: number
  capCents: number
  headroomCents: number
  usedPct: number
  daysLeft: number
  entries: { id: string; description: string; dates: string[]; cents: number; status: ConcessionalRow['status'] }[]
}

export function superCapLines(
  people: readonly { key: string; name: string; grossCents: number; hasPrivateHospital: boolean; hasHecs: boolean; plannedSacrificeCents?: number }[],
  rows: readonly ConcessionalRow[],
  today: string,
): CapLine[] {
  const { fy, end } = fyBounds(today)
  return people.map(p => {
    const b = annualTakeHome({ grossCents: p.grossCents, hasPrivateHospital: p.hasPrivateHospital, hasHecs: p.hasHecs }, fy)
    const entries = contributionsInFy(rows, p.key, today)
    const voluntary = entries.reduce((s, e) => s + e.cents, 0)
    const planned = Math.max(0, p.plannedSacrificeCents ?? 0)
    const used = b.sgCents + voluntary + planned
    return {
      personKey: p.key, name: p.name, fy, grossCents: p.grossCents, sgCents: b.sgCents, voluntaryCents: voluntary, plannedCents: planned,
      capCents: b.concessionalCapCents, headroomCents: b.concessionalCapCents - used,
      usedPct: b.concessionalCapCents > 0 ? Math.round(used / b.concessionalCapCents * 100) : 0,
      daysLeft: dayDiff(today, end),
      entries: entries.map(e => ({ id: e.row.id, description: e.row.description, dates: e.dates, cents: e.cents, status: e.row.status })),
    }
  })
}

/**
 * Salary sacrifice set in Assumptions (a yearly amount) that falls in the current FY
 * (`today`'s), from `firstMonth` to 30 June. The projection starts next month,
 * so the tracker counts only the months still to come.
 */
export function plannedSacrificeInFy(annualCents: number, firstMonth: string, today: string): number {
  if (annualCents <= 0 || fyOf(`${firstMonth}-01`) !== fyOf(today)) return 0
  const m = Number(firstMonth.slice(5, 7))
  const monthsLeft = m >= 7 ? 19 - m : 7 - m
  return Math.round(annualCents * monthsLeft / 12)
}

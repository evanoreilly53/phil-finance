// Super to retirement, per person (Phase 5). Pure.
//
// Reads each person's super balance off a long run of the main projection
// engine, so it already includes employer super (SG 12% of the salary, rising
// with wage growth), salary sacrifice (both less 15% contributions tax),
// admin fees, any FHSS release, and the super return assumption (after fees
// and earnings tax, simplified: one net rate). Shown at preservation age (60)
// in today's dollars (deflated by the inflation assumption), with a p10–p90
// band from bands.ts. Estimate, not advice.

import { cohortBands, type ClassReturn } from './bands'
import { addMonthsKey, monthDiff } from './schedule'
import type { Projection, ProjPerson } from './types'

export const PRESERVATION_AGE = 60

/** Months to run so everyone reaches preservation age (capped at 50 years). */
export function monthsToRetirement(startMonth: string, birthMonths: readonly (string | null)[]): number {
  const ends = birthMonths.filter((b): b is string => !!b).map(b => monthDiff(startMonth, addMonthsKey(b, PRESERVATION_AGE * 12)) + 1)
  return Math.min(600, Math.max(12, ...ends))
}

export type RetirementRow = { age: number; month: string; todayCents: number; nominalCents: number }

export type RetirementView = {
  personKey: string
  name: string
  /** 'YYYY-MM' the person turns 60, or null when no birth month is set. */
  retireMonth: string | null
  status: 'ok' | 'no-birth-month' | 'already-60' | 'beyond-horizon' | 'no-super'
  nowCents: number
  /** At 60, nominal and in today's dollars. */
  nominalCents: number | null
  todayCents: number | null
  band: { p10: number; p50: number; p90: number } | null
  /** Every 5 years of age (and 60), in today's dollars. */
  rows: RetirementRow[]
}

const deflate = (cents: number, months: number, inflationPct: number) => Math.round(cents / Math.pow(1 + inflationPct / 100, months / 12))

export function superToRetirement(p: Projection, people: readonly ProjPerson[], birthMonths: Record<string, string | null>, opts: { inflationPct: number; super: ClassReturn }): RetirementView[] {
  return people.map(person => {
    const ids = p.accounts.filter(a => a.type === 'super' && a.owner === person.key).map(a => a.id)
    const bal = [p.opening.balances, ...p.months.map(m => m.balances)].map(b => ids.reduce((s, id) => s + (b[id] ?? 0), 0))
    const growth = [0, ...p.months.map(m => m.trace.filter(t => t.accountId && ids.includes(t.accountId) && (t.kind === 'growth' || t.kind === 'fees')).reduce((s, t) => s + t.cents, 0))]
    const birth = birthMonths[person.key] ?? null
    const base = { personKey: person.key, name: person.name, nowCents: bal[0], nominalCents: null, todayCents: null, band: null, rows: [] as RetirementRow[] }
    if (!birth) return { ...base, retireMonth: null, status: 'no-birth-month' as const }
    const retireMonth = addMonthsKey(birth, PRESERVATION_AGE * 12)
    if (ids.length === 0) return { ...base, retireMonth, status: 'no-super' as const }
    // Month index: 0 = opening (the month before the first projected month).
    const idx = monthDiff(p.startMonth, retireMonth) + 1
    if (idx <= 0) return { ...base, retireMonth, status: 'already-60' as const }
    if (idx >= bal.length) return { ...base, retireMonth, status: 'beyond-horizon' as const }
    const bands = cohortBands(bal.slice(0, idx + 1), growth.slice(0, idx + 1), opts.super)
    const at = (i: number) => ({ nominal: bal[i], today: deflate(bal[i], i, opts.inflationPct) })
    const rows: RetirementRow[] = []
    const ageNow = Math.floor(monthDiff(birth, addMonthsKey(p.startMonth, -1)) / 12)
    for (let age = Math.ceil((ageNow + 1) / 5) * 5; age <= PRESERVATION_AGE; age += 5) {
      const i = monthDiff(p.startMonth, addMonthsKey(birth, age * 12)) + 1
      if (i > 0 && i < bal.length) rows.push({ age, month: addMonthsKey(birth, age * 12), todayCents: at(i).today, nominalCents: at(i).nominal })
    }
    const b = bands[idx]
    return {
      ...base, retireMonth, status: 'ok' as const,
      nominalCents: bal[idx], todayCents: at(idx).today,
      band: { p10: deflate(b.p10, idx, opts.inflationPct), p50: deflate(b.p50, idx, opts.inflationPct), p90: deflate(b.p90, idx, opts.inflationPct) },
      rows,
    }
  })
}

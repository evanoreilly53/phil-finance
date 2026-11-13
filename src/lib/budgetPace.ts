// Light budgets in the check-in: spend vs target with a mid-month pace, and
// suggested targets from the trailing average (the owner confirms). Pure.

import { daysInMonth } from './projection/schedule'

export type PaceStatus = 'on_track' | 'ahead' | 'over' | 'no_target'

export type PaceLine = {
  id: string
  name: string
  spentCents: number
  targetCents: number
  /** Where spending "should" be by today on an even pace through the month. */
  expectedCents: number
  status: PaceStatus
  remainingCents: number
  /** Trailing-average suggestion (rounded up to $10); null with no history. */
  suggestedCents: number | null
}

export const PACE = {
  /** "Ahead of pace" once spending is more than 10% + $20 past the even-pace line. */
  aheadPct: 10,
  aheadMinCents: 2_000,
  /** Suggestions under $20 a month aren't offered. */
  minSuggestCents: 2_000,
}

/** Share of the month gone by `today` (day d of N counts as d/N). */
export function monthFraction(today: string): number {
  const mk = today.slice(0, 7)
  return Math.min(1, Number(today.slice(8, 10)) / daysInMonth(mk))
}

export function paceStatus(spentCents: number, targetCents: number, fraction: number): { status: PaceStatus; expectedCents: number } {
  if (targetCents <= 0) return { status: 'no_target', expectedCents: 0 }
  const expected = Math.round(targetCents * fraction)
  if (spentCents > targetCents) return { status: 'over', expectedCents: expected }
  if (spentCents > expected * (1 + PACE.aheadPct / 100) + PACE.aheadMinCents) return { status: 'ahead', expectedCents: expected }
  return { status: 'on_track', expectedCents: expected }
}

/** Average monthly spend over the months given (months with no spend count as 0), rounded up to $10. */
export function suggestTarget(monthlySpendCents: readonly number[]): number | null {
  if (!monthlySpendCents.length) return null
  const avg = monthlySpendCents.reduce((s, x) => s + Math.max(0, x), 0) / monthlySpendCents.length
  if (avg < PACE.minSuggestCents) return null
  return Math.ceil(avg / 1000) * 1000
}

export function budgetPace(p: {
  categories: readonly { id: string; name: string }[]
  targets: ReadonlyMap<string, number>
  spent: ReadonlyMap<string, number>
  /** Per category, spend in each trailing complete month that has data. */
  history: ReadonlyMap<string, readonly number[]>
  today: string
}): PaceLine[] {
  const f = monthFraction(p.today)
  return p.categories.map(c => {
    const spent = Math.max(0, p.spent.get(c.id) ?? 0)
    const target = p.targets.get(c.id) ?? 0
    const { status, expectedCents } = paceStatus(spent, target, f)
    return {
      id: c.id, name: c.name, spentCents: spent, targetCents: target, expectedCents, status,
      remainingCents: target - spent, suggestedCents: suggestTarget(p.history.get(c.id) ?? []),
    }
  }).filter(l => l.targetCents > 0 || l.spentCents > 0 || l.suggestedCents !== null)
    .sort((a, b) => (b.targetCents > 0 ? 1 : 0) - (a.targetCents > 0 ? 1 : 0) || b.spentCents - a.spentCents)
}

export const PACE_LABEL: Record<PaceStatus, string> = {
  on_track: 'On track', ahead: 'Ahead of pace', over: 'Over', no_target: 'No target',
}

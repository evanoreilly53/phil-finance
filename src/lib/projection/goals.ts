// Goals on top of the projection: when a target is reached, and how much extra
// a month would reach it by a date (the back-solver). Pure.

import { runProjection } from './engine'
import { monthDiff } from './schedule'
import type { Projection, ProjectionInput } from './types'

export type GoalMetric = 'netWorthCents' | 'liquidCents' | 'depositPotCents' | 'superCents'

/** First projected month the metric is at or above target ('now' if it already is), else null. */
export function hitMonth(p: Projection, metric: GoalMetric, targetCents: number): string | 'now' | null {
  if (p.opening[metric] >= targetCents) return 'now'
  return p.months.find(m => m[metric] >= targetCents)?.month ?? null
}

export function valueAt(p: Projection, metric: GoalMetric, month: string): number | null {
  if (month < p.startMonth) return p.opening[metric]
  return p.months.find(m => m.month === month)?.[metric] ?? null
}

export type GoalSolve = {
  targetCents: number
  byMonth: string
  /** Projected month the target is first reached (null = not within the horizon). */
  projectedMonth: string | 'now' | null
  /** Months late (+) or early (−) vs byMonth; null if never reached. */
  monthsLate: number | null
  /** Projected value at byMonth. */
  valueAtByMonth: number | null
  /** Extra per month (from next month to byMonth) that reaches the target on time. 0 = on track; null = byMonth already passed. */
  extraMonthlyCents: number | null
  /** Average monthly increase in the metric up to byMonth, on the current plan. */
  currentMonthlyPaceCents: number | null
}

const MAX_EXTRA = 10_000_000 // $100k/month search ceiling

/**
 * Solve a goal against a projection input. `run` is injectable for tests.
 * Extra saving only ever increases every metric, so a bisection is exact to
 * $1; the answer is rounded up to the next $10 so it never undershoots.
 */
export function solveGoal(
  input: ProjectionInput,
  metric: GoalMetric,
  targetCents: number,
  byMonth: string,
  run: (i: ProjectionInput) => Projection = runProjection,
): GoalSolve {
  const base = run(input)
  const projectedMonth = hitMonth(base, metric, targetCents)
  const monthsLate = projectedMonth === null ? null : projectedMonth === 'now' ? 0 : monthDiff(byMonth, projectedMonth)
  const valueAtByMonth = valueAt(base, metric, byMonth)
  const span = monthDiff(base.startMonth, byMonth) + 1
  const currentMonthlyPaceCents = valueAtByMonth !== null && span > 0 ? Math.round((valueAtByMonth - base.opening[metric]) / span) : null

  let extraMonthlyCents: number | null
  if (span <= 0 || valueAtByMonth === null) extraMonthlyCents = null
  else if (valueAtByMonth >= targetCents) extraMonthlyCents = 0
  else {
    const reaches = (extra: number) => (valueAt(run({ ...input, extraMonthlyCents: (input.extraMonthlyCents ?? 0) + extra }), metric, byMonth) ?? -Infinity) >= targetCents
    let lo = 0
    let hi = Math.max(100, Math.ceil((targetCents - valueAtByMonth) / span))
    while (!reaches(hi) && hi < MAX_EXTRA) hi = Math.min(MAX_EXTRA, hi * 2)
    if (!reaches(hi)) extraMonthlyCents = null
    else {
      while (hi - lo > 100) {
        const mid = Math.floor((lo + hi) / 2)
        if (reaches(mid)) hi = mid; else lo = mid
      }
      extraMonthlyCents = Math.ceil(hi / 1000) * 1000
    }
  }
  return { targetCents, byMonth, projectedMonth, monthsLate, valueAtByMonth, extraMonthlyCents, currentMonthlyPaceCents }
}


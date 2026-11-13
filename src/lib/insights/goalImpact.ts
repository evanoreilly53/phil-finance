// "Days closer to the house deposit": re-run the projection engine with the
// insight's cash effect added and see when the deposit pot reaches its target.
// Pure; `run` is injectable for tests.

import { runProjection } from '../projection/engine'
import { daysInMonth, monthStart } from '../projection/schedule'
import { dayDiff } from '../import/dates'
import type { Projection, ProjectionInput, ProjCashflow } from '../projection/types'
import type { DepositEffect, Insight } from './types'

/**
 * Days from the start of the projection until the deposit pot reaches
 * `targetCents`, interpolating within the month it crosses (0 = already
 * there; null = not reached within the horizon).
 */
export function depositHitDay(p: Projection, targetCents: number): number | null {
  if (p.opening.depositPotCents >= targetCents) return 0
  const origin = monthStart(p.startMonth)
  let prev = p.opening.depositPotCents
  for (const m of p.months) {
    if (m.depositPotCents >= targetCents) {
      const frac = m.depositPotCents === prev ? 1 : Math.min(1, Math.max(0, (targetCents - prev) / (m.depositPotCents - prev)))
      return dayDiff(origin, monthStart(m.month)) + frac * daysInMonth(m.month)
    }
    prev = m.depositPotCents
  }
  return null
}

/** The projection input with an insight's effect applied. */
export function withEffect(input: ProjectionInput, effect: DepositEffect): ProjectionInput {
  if ('monthlyCents' in effect) return { ...input, extraMonthlyCents: (input.extraMonthlyCents ?? 0) + effect.monthlyCents }
  if ('sacrifice' in effect) {
    const by = new Map((input.sacrifice ?? []).map(s => [s.personKey, s.annualCents]))
    for (const s of effect.sacrifice) by.set(s.personKey, (by.get(s.personKey) ?? 0) + s.annualCents)
    return { ...input, sacrifice: [...by].map(([personKey, annualCents]) => ({ personKey, annualCents })), fhss: input.fhss ?? effect.fhss }
  }
  const oneOff: ProjCashflow = {
    id: 'insight:one-off', description: 'Insight what-if', kind: effect.oneOffCents >= 0 ? 'income' : 'expense', personKey: null,
    amountCents: Math.abs(effect.oneOffCents), currency: 'AUD', frequency: 'once', startDate: monthStart(input.startMonth), endDate: null,
    indexation: 'none', indexationPct: null, accountId: null, toAccountId: null, eventId: null,
  }
  return { ...input, cashflows: [...input.cashflows, oneOff] }
}

/**
 * Fill in `depositDays` (+ = sooner) on each insight that has a deposit
 * effect. `input` should be the deposit-goal input (house purchase excluded,
 * horizon long enough). Insights without an effect keep depositDays null.
 */
export function attachDepositDays(
  insights: readonly Insight[],
  input: ProjectionInput | null,
  targetCents: number | null,
  run: (i: ProjectionInput) => Projection = runProjection,
): Insight[] {
  if (!input || !targetCents) return insights.map(i => ({ ...i, depositDays: null, depositNote: i.depositNote ?? (i.depositEffect ? 'No house deposit goal set up.' : undefined) }))
  const base = depositHitDay(run(input), targetCents)
  return insights.map(i => {
    if (!i.depositEffect) return { ...i, depositDays: null }
    if (base === 0) return { ...i, depositDays: null, depositNote: 'The deposit is already covered.' }
    const after = depositHitDay(run(withEffect(input, i.depositEffect)), targetCents)
    if (base === null || after === null) return { ...i, depositDays: null, depositNote: 'The deposit isn’t reached within the projection either way.' }
    return { ...i, depositDays: Math.round(base - after) }
  })
}

export { depositDaysLabel } from './labels'

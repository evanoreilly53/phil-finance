// The insights engine: run every rule over the context, attach "days closer
// to the deposit" from the projection engine, then rank and cap. Pure.

import { goalDrift } from './rules/goal'
import { idleCash } from './rules/cash'
import { fhssWindow, capHeadroom } from './rules/super'
import { subscriptionChanges } from './rules/subscriptions'
import { categorySpike, budgetOverrun, lifestyleCreep } from './rules/spending'
import { priceCliff } from './rules/house'
import { fxFees, eurExposure } from './rules/fx'
import { staleData, uncategorised } from './rules/hygiene'
import { attachDepositDays } from './goalImpact'
import { rankInsights, type Ranked } from './rank'
import type { Projection, ProjectionInput } from '../projection/types'
import type { Insight, InsightContext, InsightStateRow, RuleId } from './types'

export const RULES: Record<RuleId, (ctx: InsightContext) => Insight[]> = {
  goal_drift: goalDrift,
  idle_cash: idleCash,
  fhss_window: fhssWindow,
  cap_headroom: capHeadroom,
  subscriptions: subscriptionChanges,
  category_spike: categorySpike,
  budget_overrun: budgetOverrun,
  lifestyle_creep: lifestyleCreep,
  price_cliff: priceCliff,
  fx_fees: fxFees,
  eur_exposure: eurExposure,
  stale_data: staleData,
  uncategorised,
}

/** Every rule's candidates. A rule that throws is skipped (and reported) rather than taking the check-in down. */
export function candidateInsights(ctx: InsightContext): { insights: Insight[]; errors: { rule: RuleId; message: string }[] } {
  const insights: Insight[] = []
  const errors: { rule: RuleId; message: string }[] = []
  for (const [rule, fn] of Object.entries(RULES) as [RuleId, (c: InsightContext) => Insight[]][]) {
    try { insights.push(...fn(ctx)) } catch (e) { errors.push({ rule, message: e instanceof Error ? e.message : String(e) }) }
  }
  return { insights, errors }
}

export function runInsights(p: {
  ctx: InsightContext
  states: readonly InsightStateRow[]
  /** Deposit-goal projection input (house purchase excluded); null without a house plan. */
  depositInput: ProjectionInput | null
  depositTargetCents: number | null
  run?: (i: ProjectionInput) => Projection
  max?: number
}): Ranked & { errors: { rule: RuleId; message: string }[] } {
  const { insights, errors } = candidateInsights(p.ctx)
  const ranked = rankInsights(insights, p.states, { today: p.ctx.today, thisMonth: p.ctx.thisMonth, max: p.max })
  // Only the insights that will be displayed pay for a projection run.
  const withDays = (xs: Insight[]) => attachDepositDays(xs, p.depositInput, p.depositTargetCents, p.run)
  return {
    shown: withDays(ranked.shown),
    more: withDays(ranked.more),
    hidden: ranked.hidden,
    errors,
  }
}

export type { Insight, InsightContext, InsightStateRow } from './types'
export { depositDaysLabel } from './labels'
export { MAX_SHOWN } from './rank'

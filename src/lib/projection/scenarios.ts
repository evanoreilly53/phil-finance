// Named scenarios: which rows a scenario sees, and the numbers used to compare
// scenarios side by side. Pure.
//
// A scenario = a fork of its parent (usually the baseline):
//   • assumptions it overrides (the rest are inherited),
//   • its own house plan (a house_purchase life event with scenario_id set,
//     which REPLACES the shared one),
//   • its own extra events (e.g. leave) and planned items.

import { ASSUMPTIONS, PERSON_ASSUMPTIONS, type AssumptionKey, type ResolvedAssumption } from '../assumptions'
import { runProjection } from './engine'
import { hitMonth } from './goals'
import { monthDiff } from './schedule'
import type { HouseParams, Projection, ProjectionInput } from './types'

export type ScenarioRow = { id: string; name: string; description?: string | null; is_baseline: boolean; parent_scenario_id: string | null; sort_order?: number; is_archived?: boolean }

/** The scenario and its ancestors, nearest first. Unknown id → []. */
export function scenarioChain(id: string | null, scenarios: readonly Pick<ScenarioRow, 'id' | 'parent_scenario_id'>[]): string[] {
  const byId = new Map(scenarios.map(s => [s.id, s]))
  const chain: string[] = []
  for (let cur: string | null = id; cur && byId.has(cur) && !chain.includes(cur); cur = byId.get(cur)!.parent_scenario_id) chain.push(cur)
  return chain
}

type EventLike = { id: string; scenario_id: string | null; kind: string; status: string }

/**
 * Events a scenario sees: shared ones (no scenario) plus those of the scenario
 * and its ancestors. Only ONE house purchase applies: the nearest in the chain
 * (the scenario's own beats its parent's beats the shared plan).
 */
export function selectScenarioEvents<E extends EventLike>(events: readonly E[], chain: readonly string[]): E[] {
  const rank = (e: E) => (e.scenario_id === null ? chain.length : chain.indexOf(e.scenario_id))
  const visible = events.filter(e => e.scenario_id === null || chain.includes(e.scenario_id))
  const houses = visible.filter(e => e.kind === 'house_purchase' && e.status !== 'cancelled')
  const best = houses.length ? Math.min(...houses.map(rank)) : -1
  return visible.filter(e => e.kind !== 'house_purchase' || e.status === 'cancelled' || rank(e) === best)
}

// ── Comparison ────────────────────────────────────────────────────────────────

export type ScenarioSummary = {
  houseMonth: string | null
  priceCents: number | null
  upfrontCents: number | null
  costsCents: number | null
  /** First month the deposit pot reaches the upfront cash (run without the purchase). */
  depositReadyMonth: string | 'now' | null
  /** Months the deposit is ready before (−) or after (+) the planned purchase. */
  depositMonthsLate: number | null
  loanCents: number | null
  monthlyRepaymentCents: number | null
  netWorthAtCents: number | null
  liquidAtCents: number | null
  atMonth: string
  lowestCash: { month: string; cents: number } | null
  /** Mortgage interest from the purchase to `atMonth`. */
  interestToAtCents: number
  /** Phase 5: salary sacrifice a year (all people) and the FHSS release landing in cash, after tax. */
  sacrificeAnnualCents: number
  fhssNetCents: number
  /** Phase 5: total super at `atMonth`. */
  superAtCents: number | null
  warnings: string[]
}

/** Headline numbers for a scenario, at `atMonth` (e.g. Dec 2030). */
export function summariseScenario(input: ProjectionInput, house: { date: string; params: HouseParams } | null, atMonth: string, run = runProjection): ScenarioSummary {
  const months = Math.max(input.months, monthDiff(input.startMonth, atMonth) + 1)
  const p: Projection = run({ ...input, months })
  const at = p.months.find(m => m.month === atMonth) ?? p.months[p.months.length - 1]
  let lowest: ScenarioSummary['lowestCash'] = null
  for (const m of p.months) {
    if (m.month > at.month) break
    if (!lowest || m.liquidCents < lowest.cents) lowest = { month: m.month, cents: m.liquidCents }
  }

  let depositReadyMonth: ScenarioSummary['depositReadyMonth'] = null
  let depositMonthsLate: number | null = null
  let loanCents: number | null = null
  let repayment: number | null = null
  let interest = 0
  if (house) {
    const hm = house.date.slice(0, 7)
    const noBuy = run({ ...input, months: Math.min(600, Math.max(months, monthDiff(input.startMonth, hm) + 121)), excludeEventKinds: ['house_purchase'] })
    depositReadyMonth = hitMonth(noBuy, 'depositPotCents', house.params.upfrontCents)
    depositMonthsLate = depositReadyMonth === null ? null : depositReadyMonth === 'now' ? monthDiff(hm, input.startMonth) : monthDiff(hm, depositReadyMonth)
    const loanAcc = p.accounts.find(a => a.type === 'mortgage' && a.synthetic)
    if (loanAcc) {
      const drawn = p.months.find(m => m.balances[loanAcc.id] !== undefined)
      loanCents = drawn ? -(drawn.balances[loanAcc.id] ?? 0) : null
      repayment = loanAcc.loan?.repaymentCents ?? null
      for (const m of p.months) {
        if (m.month > at.month) break
        interest += loanInterest(m, loanAcc.id)
      }
    }
  }

  return {
    houseMonth: house?.date.slice(0, 7) ?? null,
    priceCents: house?.params.priceCents ?? null,
    upfrontCents: house?.params.upfrontCents ?? null,
    costsCents: house?.params.costsCents ?? null,
    depositReadyMonth, depositMonthsLate, loanCents, monthlyRepaymentCents: repayment,
    netWorthAtCents: at?.netWorthCents ?? null, liquidAtCents: at?.liquidCents ?? null, atMonth: at?.month ?? atMonth,
    lowestCash: lowest, interestToAtCents: interest,
    sacrificeAnnualCents: (input.sacrifice ?? []).reduce((s, x) => s + x.annualCents, 0),
    fhssNetCents: p.fhss.reduce((s, r) => s + r.netCents, 0),
    superAtCents: at?.superCents ?? null,
    warnings: p.warnings,
  }
}

export type PersonAssumptionDiff = { key: string; label: string; from: number; to: number }

/** Per-person assumptions (salary sacrifice, birth month) that differ from the reference. */
export function diffPersonAssumptions(
  ref: Record<string, Record<string, ResolvedAssumption>>, s: Record<string, Record<string, ResolvedAssumption>>,
  people: readonly { key: string; name: string }[],
): PersonAssumptionDiff[] {
  const out: PersonAssumptionDiff[] = []
  for (const p of people) {
    for (const [base, def] of Object.entries(PERSON_ASSUMPTIONS)) {
      const a = ref[p.key]?.[base]?.value ?? def.default, b = s[p.key]?.[base]?.value ?? def.default
      if (a !== b) out.push({ key: `${base}__${p.key}`, label: `${p.name}: ${def.label.toLowerCase()}`, from: a, to: b })
    }
  }
  return out
}

/** Interest charged on a loan account in a month (positive). Repayments are the in-leg with no NW effect. */
function loanInterest(m: Projection['months'][number], accountId: string): number {
  return -m.trace.filter(t => t.accountId === accountId && t.kind === 'loan' && t.nwCents < 0).reduce((s, t) => s + t.cents, 0)
}

// ── Diffing ───────────────────────────────────────────────────────────────────

export type AssumptionDiff = { key: AssumptionKey; label: string; from: number; to: number }

/** Assumptions where the scenario differs from the reference (e.g. baseline). */
export function diffAssumptions(ref: Record<AssumptionKey, ResolvedAssumption>, s: Record<AssumptionKey, ResolvedAssumption>): AssumptionDiff[] {
  return (Object.keys(ASSUMPTIONS) as AssumptionKey[])
    .filter(k => ref[k].value !== s[k].value)
    .map(k => ({ key: k, label: ASSUMPTIONS[k].label, from: ref[k].value, to: s[k].value }))
}

export type HouseDiff = { field: string; from: string; to: string }

const $k = (c: number) => `$${Math.round(c / 100).toLocaleString('en-AU')}`

/** Human-readable differences between two house plans. */
export function diffHouse(a: { date: string; params: HouseParams } | null, b: { date: string; params: HouseParams } | null): HouseDiff[] {
  if (!a && !b) return []
  if (!a || !b) return [{ field: 'House purchase', from: a ? 'planned' : 'none', to: b ? 'planned' : 'none' }]
  const out: HouseDiff[] = []
  const push = (field: string, x: string, y: string) => { if (x !== y) out.push({ field, from: x, to: y }) }
  push('Month', a.date.slice(0, 7), b.date.slice(0, 7))
  push('Price', $k(a.params.priceCents), $k(b.params.priceCents))
  push('Upfront cash', $k(a.params.upfrontCents), $k(b.params.upfrontCents))
  push('Property', a.params.propertyKind, b.params.propertyKind)
  push('5% scheme', a.params.useScheme ? 'yes' : 'no', b.params.useScheme ? 'yes' : 'no')
  push('First home', a.params.firstHome ? 'yes' : 'no', b.params.firstHome ? 'yes' : 'no')
  push('Extra repayment', $k(a.params.extraRepaymentMonthlyCents), $k(b.params.extraRepaymentMonthlyCents))
  push('Offset', a.params.offsetAccountId ?? 'none', b.params.offsetAccountId ?? 'none')
  return out
}

// ── Example scenarios (seeded on request, editable) ──────────────────────────

export type ScenarioSeed = {
  name: string
  description: string
  assumptions: Partial<Record<AssumptionKey, number>>
  house: { month: string; priceCents: number; upfrontCents: number; useScheme: boolean } | null
  leave: { personIndex: number; startMonth: string; months: number; payPct: number } | null
}

/** Suggested examples, built from the current plan so they stay relevant. */
export function exampleScenarios(p: { houseMonth: string | null; mortgageRatePct: number; today: string }): ScenarioSeed[] {
  const year = Number(p.today.slice(0, 4))
  const earlyMonth = `${year + 1}-09`
  const after = p.houseMonth ?? `${year + 2}-03`
  return [
    {
      name: `$850k in ${earlyMonth.slice(0, 4)} with the 5% scheme`,
      description: 'Buy earlier at the Perth 5% Deposit Scheme cap: smaller deposit, no LMI, bigger loan.',
      assumptions: {},
      house: { month: earlyMonth, priceCents: 85_000_000, upfrontCents: 8_500_000, useScheme: true },
      leave: null,
    },
    {
      name: 'One income for 12 months',
      description: 'One of you takes a year off (unpaid) after the purchase. Change who, when and the % of pay.',
      assumptions: {},
      house: null,
      leave: { personIndex: 1, startMonth: after, months: 12, payPct: 0 },
    },
    {
      name: 'Rates +1%',
      description: 'Mortgage rate one point higher than the baseline.',
      assumptions: { mortgage_rate_pct: Math.round((p.mortgageRatePct + 1) * 100) / 100 },
      house: null,
      leave: null,
    },
  ]
}

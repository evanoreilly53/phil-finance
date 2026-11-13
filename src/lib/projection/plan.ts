// Building the projection input for a scenario from fetched rows. Pure, so one
// fetch (load.ts) can build several scenarios for the side-by-side comparison.

import { latestBalanceByAccount } from '@/lib/balances'
import { resolveAssumptions, resolvePersonAssumptions, ASSUMPTIONS, type AssumptionKey, type PersonAssumptions, type ResolvedAssumption } from '@/lib/assumptions'
import { fhssProjectionMonths } from '@/lib/house/fhss'
import { addMonths } from '@/lib/format'
import { chooseRate } from '@/lib/fx'
import {
  chooseSweepAccount, defaultDepositAccountIds, depositAccountIdsFromParams,
  houseParams, leaveParams, selectCashflows, type CashflowRow, type Skipped,
} from './inputs'
import { solveGoal, type GoalSolve } from './goals'
import { monthDiff } from './schedule'
import { scenarioChain, selectScenarioEvents, type ScenarioRow } from './scenarios'
import type { Assumptions, HouseParams, NetIncome, ProjAccount, ProjEvent, ProjectionInput, ProjPerson, Salary, SpendingBaseline } from './types'

export type HouseEvent = { id: string; scenarioId: string | null; name: string; date: string; status: string; house: HouseParams; params: Record<string, unknown> }

export type Plan = {
  input: ProjectionInput
  scenario: { id: string; name: string; isBaseline: boolean; description: string | null } | null
  scenarios: ScenarioRow[]
  assumptions: Record<AssumptionKey, ResolvedAssumption>
  people: ProjPerson[]
  salaryRows: (Salary & { frequency: string })[]
  house: HouseEvent | null
  /** Leave events in this scenario (for the editor). */
  leaves: { id: string; scenarioId: string | null; name: string; date: string; endDate: string; personKey: string; payPct: number }[]
  skipped: Skipped[]
  fx: { currency: string; rate: number; date: string | null; source: 'stored' | 'fallback' | 'assumption' }[]
  incomeNote: string
  /** Phase 5: per-person assumptions (salary sacrifice, birth month). */
  personAssumptions: Record<string, PersonAssumptions>
  /** Phase 5: whether FHSS is in this plan's projection, and why not when it isn't. */
  fhss: { on: boolean; wanted: boolean; requestMonth: string | null; releaseMonth: string | null; note: string | null }
}

export type HouseholdMember = { key: string; label: string; income_cents: number }

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

export type AccountRow = {
  id: string; name: string; type: ProjAccount['type']; owner: string; currency: string; is_liquid: boolean
  interest_rate_pct: number | null; expected_return_pct: number | null; fee_pct: number | null; annual_fee_cents: number | null
  loan_original_cents: number | null; loan_start_date: string | null; loan_term_months: number | null; loan_repayment_cents: number | null
  loan_repayment_freq: 'weekly' | 'fortnightly' | 'monthly' | null; loan_interest_only: boolean; offset_account_id: string | null
}
export type EventRow = { id: string; scenario_id: string | null; name: string; kind: string; event_date: string; end_date: string | null; status: 'planned' | 'done' | 'cancelled'; budget_cents: number | null; params: unknown }

/** Everything the plan needs, fetched once. */
export type PlanData = {
  today: string
  thisMonth: string
  accounts: AccountRow[]
  snapshots: { account_id: string; aud_balance_cents: number; date: string }[]
  people: { key: string; display_name: string; has_private_hospital: boolean; has_hecs: boolean }[]
  scenarios: ScenarioRow[]
  assumptionRows: { scenario_id: string; key: string; value: number | string }[]
  events: EventRow[]
  cashflowRows: CashflowRow[]
  spending: SpendingBaseline
  fxRows: { from_currency: string; rate: number; date: string }[]
  members: HouseholdMember[]
}

/** Build the plan for one scenario (baseline when the id is missing or unknown). Pure. */
export function buildPlan(d: PlanData, opts: { months?: number; scenarioId?: string | null } = {}): Plan {
  const baseline = d.scenarios.find(s => s.is_baseline) ?? null
  const scenario = (opts.scenarioId && d.scenarios.find(s => s.id === opts.scenarioId)) || baseline
  const chain = scenarioChain(scenario?.id ?? null, d.scenarios)
  const resolved = resolveAssumptions(scenario?.id ?? '', d.scenarios, d.assumptionRows)
  const a = Object.fromEntries((Object.keys(ASSUMPTIONS) as AssumptionKey[]).map(k => [k, resolved[k].value])) as Assumptions

  // ── Accounts with latest balances ──────────────────────────────────────────
  const latest = latestBalanceByAccount(d.snapshots)
  const projAccounts: ProjAccount[] = d.accounts.map(x => {
    const l = latest.get(x.id)
    const isLoan = x.type === 'mortgage' || x.type === 'loan'
    return {
      id: x.id, name: x.name, type: x.type, owner: x.owner, isLiquid: x.is_liquid, currency: x.currency,
      balanceCents: l?.cents ?? (isLoan && x.loan_original_cents ? -x.loan_original_cents : 0),
      balanceAsOf: l?.date ?? null,
      interestRatePct: n(x.interest_rate_pct), expectedReturnPct: n(x.expected_return_pct), feePct: n(x.fee_pct), annualFeeCents: n(x.annual_fee_cents),
      loan: isLoan ? {
        repaymentCents: n(x.loan_repayment_cents), repaymentFreq: x.loan_repayment_freq, startDate: x.loan_start_date,
        termMonths: n(x.loan_term_months), interestOnly: x.loan_interest_only, offsetAccountId: x.offset_account_id,
      } : null,
    }
  })

  // ── People + income ────────────────────────────────────────────────────────
  const projPeople: ProjPerson[] = d.people.map(p => ({ key: p.key, name: p.display_name, hasPrivateHospital: p.has_private_hospital, hasHecs: p.has_hecs }))
  const visibleEvents = selectScenarioEvents(d.events, chain)
  const cancelledEventIds = new Set(visibleEvents.filter(e => e.status === 'cancelled').map(e => e.id))
  const sel = selectCashflows(d.cashflowRows, { today: d.today, scenarioId: scenario?.id ?? null, scenarioIds: new Set(chain), cancelledEventIds })
  const freqOf = new Map(d.cashflowRows.map(r => [r.id, r.frequency]))
  const netIncomes: NetIncome[] = d.members
    .filter(m => m && typeof m.key === 'string' && Number(m.income_cents) > 0)
    .map(m => ({ personKey: m.key, label: m.label ?? m.key, monthlyNetCents: Math.round(Number(m.income_cents)), source: 'Net monthly pay from Settings (not tax-modelled)' }))
  const withSalary = new Set(sel.salaries.map(s => s.personKey))
  const fallbackPeople = netIncomes.filter(x => x.personKey && !withSalary.has(x.personKey)).map(x => x.label)
  const incomeNote = sel.salaries.length === 0 && netIncomes.length === 0
    ? 'No income set up yet: add each person’s gross salary in Assumptions.'
    : fallbackPeople.length
      ? `${fallbackPeople.join(' and ')}: net pay from Settings until a gross salary is added in Assumptions.`
      : 'Gross salaries through the tax engine.'

  // ── Events ─────────────────────────────────────────────────────────────────
  const projEvents: ProjEvent[] = visibleEvents.map(e => ({
    id: e.id, name: e.name, kind: e.kind, date: e.event_date, status: e.status,
    house: e.kind === 'house_purchase' ? houseParams(e.params, e.budget_cents, e.event_date) : null,
    leave: e.kind === 'leave' ? leaveParams(e.params, e.end_date) : null,
  }))
  const houseRow = visibleEvents.find(e => e.kind === 'house_purchase' && e.status !== 'cancelled')
  const houseParsed = houseRow ? houseParams(houseRow.params, houseRow.budget_cents, houseRow.event_date) : null
  const house: HouseEvent | null = houseRow && houseParsed ? {
    id: houseRow.id, scenarioId: houseRow.scenario_id, name: houseRow.name, date: houseRow.event_date, status: houseRow.status, house: houseParsed,
    params: (houseRow.params && typeof houseRow.params === 'object' && !Array.isArray(houseRow.params) ? houseRow.params : {}) as Record<string, unknown>,
  } : null
  const leaves = visibleEvents.filter(e => e.kind === 'leave' && e.status !== 'cancelled').flatMap(e => {
    const l = leaveParams(e.params, e.end_date)
    return l ? [{ id: e.id, scenarioId: e.scenario_id, name: e.name, date: e.event_date, endDate: l.endDate, personKey: l.personKey, payPct: l.payPct }] : []
  })

  // ── FX (AUD per unit) ──────────────────────────────────────────────────────
  const currencies = new Set(sel.cashflows.map(c => c.currency).filter(c => c !== 'AUD'))
  currencies.add('EUR')
  const fxInfo: Plan['fx'] = []
  const fx: Record<string, number> = {}
  for (const cur of currencies) {
    const stored = d.fxRows.find(r => r.from_currency === cur)
    const choice = chooseRate(cur, stored ?? null)
    if (choice?.source === 'stored') { fx[cur] = choice.rate; fxInfo.push({ currency: cur, rate: choice.rate, date: choice.date, source: 'stored' }) }
    else if (cur === 'EUR') { fx[cur] = a.fx_eur_aud; fxInfo.push({ currency: cur, rate: a.fx_eur_aud, date: null, source: 'assumption' }) }
    else if (choice) { fx[cur] = choice.rate; fxInfo.push({ currency: cur, rate: choice.rate, date: null, source: 'fallback' }) }
  }

  // ── Salary sacrifice + FHSS (Phase 5) ──────────────────────────────────────
  const personAssumptions = resolvePersonAssumptions(scenario?.id ?? '', d.scenarios, d.assumptionRows, projPeople.map(p => p.key))
  const sacrifice = projPeople
    .map(p => ({ personKey: p.key, annualCents: Math.round((personAssumptions[p.key]?.salary_sacrifice.value ?? 0) * 100) }))
    .filter(s => s.annualCents > 0)
  const startMonth = addMonths(d.thisMonth, 1)
  const fhssWanted = a.fhss_use === 1
  let fhss: Plan['fhss'] = { on: false, wanted: fhssWanted, requestMonth: null, releaseMonth: null, note: null }
  if (fhssWanted) {
    const hm = house?.date.slice(0, 7) ?? null
    const months = hm ? fhssProjectionMonths(hm) : null
    const note = !house ? 'No house purchase in this plan.'
      : house.status !== 'planned' ? 'The house is marked as bought.'
      : !house.house.firstHome ? 'FHSS is for first-home buyers only.'
      : months!.requestMonth <= startMonth ? 'The house month is too close for an FHSS release.'
      : sacrifice.length === 0 ? 'No salary sacrifice set: add one per person in Assumptions.'
      : null
    fhss = { on: note === null || note.startsWith('No salary'), wanted: true, requestMonth: months?.requestMonth ?? null, releaseMonth: months?.releaseMonth ?? null, note }
  }

  const input: ProjectionInput = {
    today: d.today,
    startMonth,
    months: opts.months ?? 60,
    assumptions: a,
    accounts: projAccounts,
    people: projPeople,
    salaries: sel.salaries,
    netIncomes,
    spending: d.spending,
    cashflows: sel.cashflows,
    events: projEvents,
    fx,
    sweepAccountId: chooseSweepAccount(projAccounts),
    depositAccountIds: (house && depositAccountIdsFromParams(house.params)) ?? defaultDepositAccountIds(projAccounts),
    extraMonthlyCents: Math.round((a.extra_saving_monthly ?? 0) * 100),
    ...(sacrifice.length ? { sacrifice } : {}),
    ...(fhss.on ? { fhss: { requestMonth: fhss.requestMonth!, releaseMonth: fhss.releaseMonth! } } : {}),
  }

  return {
    input,
    scenario: scenario ? { id: scenario.id, name: scenario.name, isBaseline: scenario.is_baseline, description: scenario.description ?? null } : null,
    scenarios: d.scenarios,
    assumptions: resolved,
    people: projPeople,
    salaryRows: sel.salaries.map(s => ({ ...s, frequency: freqOf.get(s.id) ?? 'annual' })),
    house,
    leaves,
    skipped: sel.skipped,
    fx: fxInfo,
    incomeNote,
    personAssumptions,
    fhss,
  }
}

export type DepositGoal = GoalSolve & { eventName: string; currentCents: number }

/** The projection input the deposit goal runs on: no purchase, horizon well past the house month. */
export function depositGoalInput(plan: Plan): ProjectionInput | null {
  if (!plan.house) return null
  const byMonth = plan.house.date.slice(0, 7)
  const months = Math.max(plan.input.months, monthDiff(plan.input.startMonth, byMonth) + 1 + 120)
  return { ...plan.input, months: Math.min(months, 600), excludeEventKinds: ['house_purchase'] }
}

/**
 * The headline goal: the house's upfront cash (deposit + costs) by the house
 * date. Run WITHOUT the purchase, so "when do we have the deposit?" isn't
 * confused by the deposit being spent.
 */
export function depositGoal(plan: Plan): DepositGoal | null {
  const input = depositGoalInput(plan)
  if (!plan.house || !input) return null
  const byMonth = plan.house.date.slice(0, 7)
  const solve = solveGoal(input, 'depositPotCents', plan.house.house.upfrontCents, byMonth)
  const opening = plan.input.accounts.filter(x => plan.input.depositAccountIds.includes(x.id) || x.id === plan.input.sweepAccountId)
    .reduce((s, x) => s + x.balanceCents, 0)
  return { ...solve, eventName: plan.house.name, currentCents: opening }
}

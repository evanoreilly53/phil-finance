// Server-side loader: reads the household's plan from Supabase and builds the
// projection input. All rules about what counts live in the pure modules
// (inputs.ts / engine.ts); this file only fetches and maps rows.

import type { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { latestBalanceByAccount } from '@/lib/balances'
import { resolveAssumptions, ASSUMPTIONS, type AssumptionKey, type ResolvedAssumption } from '@/lib/assumptions'
import { addMonths, perthMonthKey } from '@/lib/format'
import { perthToday } from '@/lib/import/dates'
import { chooseRate } from '@/lib/fx'
import { getSetting } from '@/lib/settings'
import {
  BASELINE_EXCLUDE, chooseSweepAccount, defaultDepositAccountIds, depositAccountIdsFromParams,
  houseParams, selectCashflows, spendingBaseline, type CashflowRow, type Skipped,
} from './inputs'
import { solveGoal, type GoalSolve } from './goals'
import { monthDiff } from './schedule'
import type { Assumptions, HouseParams, NetIncome, ProjAccount, ProjEvent, ProjectionInput, ProjPerson, Salary } from './types'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type HouseEvent = { id: string; name: string; date: string; status: string; house: HouseParams; params: Record<string, unknown> }

export type Plan = {
  input: ProjectionInput
  scenario: { id: string; name: string } | null
  assumptions: Record<AssumptionKey, ResolvedAssumption>
  people: ProjPerson[]
  salaryRows: (Salary & { frequency: string })[]
  house: HouseEvent | null
  skipped: Skipped[]
  fx: { currency: string; rate: number; date: string | null; source: 'stored' | 'fallback' | 'assumption' }[]
  incomeNote: string
}

const SPEND_MONTHS = 6
type HouseholdMember = { key: string; label: string; income_cents: number }

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

export async function loadPlan(supabase: Supabase, opts: { months?: number } = {}): Promise<Plan> {
  const today = perthToday()
  const thisMonth = perthMonthKey()
  const spendMonths = Array.from({ length: SPEND_MONTHS }, (_, i) => addMonths(thisMonth, i - SPEND_MONTHS))

  const [
    { data: accounts, error: aErr }, snapshots, { data: people }, { data: scenarios }, { data: assumptionRows },
    { data: events }, cashflowRows, txs, { data: categories }, { data: budgets }, { data: fxRows }, members,
  ] = await Promise.all([
    supabase.from('accounts').select('id, name, type, owner, currency, is_liquid, interest_rate_pct, expected_return_pct, fee_pct, annual_fee_cents, loan_original_cents, loan_start_date, loan_term_months, loan_repayment_cents, loan_repayment_freq, loan_interest_only, offset_account_id').eq('is_active', true),
    fetchAll((from, to) => supabase.from('account_snapshots').select('account_id, aud_balance_cents, date').order('date').order('id').range(from, to)),
    supabase.from('people').select('key, display_name, has_private_hospital, has_hecs, sort_order').order('sort_order'),
    supabase.from('scenarios').select('id, name, is_baseline, parent_scenario_id').eq('is_archived', false),
    supabase.from('assumptions').select('scenario_id, key, value'),
    supabase.from('life_events').select('id, scenario_id, name, kind, event_date, status, budget_cents, params').eq('is_archived', false).order('event_date'),
    fetchAll((from, to) => supabase.from('planned_cashflows')
      .select('id, description, kind, person_key, amount_cents, currency, is_gross, frequency, start_date, end_date, indexation, indexation_pct, account_id, to_account_id, event_id, status, source_table, scenario_id')
      .eq('status', 'planned').order('start_date').order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('transactions').select('date, aud_amount_cents, category_id, is_transfer')
      .gte('date', `${spendMonths[0]}-01`).lt('date', `${thisMonth}-01`).order('id').range(from, to)),
    supabase.from('categories').select('id, name, parent_id, kind'),
    supabase.from('budgets').select('category_id, monthly_cents, effective_from'),
    supabase.from('fx_rates').select('from_currency, rate, date').eq('to_currency', 'AUD').order('date', { ascending: false }).limit(50),
    getSetting<HouseholdMember[]>('household_members', []),
  ])
  if (aErr) throw new Error(`Failed to load accounts: ${aErr.message}`)

  // ── Scenario + assumptions (baseline only in Phase 2) ──────────────────────
  const baseline = (scenarios ?? []).find(s => s.is_baseline) ?? null
  const resolved = resolveAssumptions(baseline?.id ?? '', scenarios ?? [], assumptionRows ?? [])
  const a = Object.fromEntries((Object.keys(ASSUMPTIONS) as AssumptionKey[]).map(k => [k, resolved[k].value])) as Assumptions

  // ── Accounts with latest balances ──────────────────────────────────────────
  const latest = latestBalanceByAccount(snapshots)
  const projAccounts: ProjAccount[] = (accounts ?? []).map(x => {
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
  const projPeople: ProjPerson[] = (people ?? []).map(p => ({ key: p.key, name: p.display_name, hasPrivateHospital: p.has_private_hospital, hasHecs: p.has_hecs }))
  const visibleEvents = (events ?? []).filter(e => !e.scenario_id || e.scenario_id === baseline?.id)
  const cancelledEventIds = new Set(visibleEvents.filter(e => e.status === 'cancelled').map(e => e.id))
  const sel = selectCashflows(cashflowRows as CashflowRow[], { today, scenarioId: baseline?.id ?? null, cancelledEventIds })
  const freqOf = new Map((cashflowRows as CashflowRow[]).map(r => [r.id, r.frequency]))
  const netIncomes: NetIncome[] = (Array.isArray(members) ? members : [])
    .filter(m => m && typeof m.key === 'string' && Number(m.income_cents) > 0)
    .map(m => ({ personKey: m.key, label: m.label ?? m.key, monthlyNetCents: Math.round(Number(m.income_cents)), source: 'Net monthly pay from Settings (not tax-modelled)' }))
  const withSalary = new Set(sel.salaries.map(s => s.personKey))
  const fallbackPeople = netIncomes.filter(x => x.personKey && !withSalary.has(x.personKey)).map(x => x.label)
  const incomeNote = sel.salaries.length === 0 && netIncomes.length === 0
    ? 'No income set up yet: add each person’s gross salary in Assumptions.'
    : fallbackPeople.length
      ? `${fallbackPeople.join(' and ')}: net pay from Settings until a gross salary is added in Assumptions.`
      : 'Gross salaries through the tax engine.'

  // ── Spending baseline ──────────────────────────────────────────────────────
  const cats = (categories ?? []).map(c => ({ id: c.id, name: c.name, parent_id: c.parent_id, kind: c.kind }))
  const excludeRootIds = new Set(cats.filter(c => !c.parent_id && BASELINE_EXCLUDE.test(c.name)).map(c => c.id))
  const spending = spendingBaseline({ txs, categories: cats, budgets: budgets ?? [], months: spendMonths, budgetMonth: thisMonth, excludeRootIds })

  // ── Events ─────────────────────────────────────────────────────────────────
  const projEvents: ProjEvent[] = visibleEvents.map(e => ({
    id: e.id, name: e.name, kind: e.kind, date: e.event_date, status: e.status,
    house: e.kind === 'house_purchase' ? houseParams(e.params, e.budget_cents) : null,
  }))
  const houseRow = visibleEvents.find(e => e.kind === 'house_purchase' && e.status !== 'cancelled')
  const houseParsed = houseRow ? houseParams(houseRow.params, houseRow.budget_cents) : null
  const house: HouseEvent | null = houseRow && houseParsed ? {
    id: houseRow.id, name: houseRow.name, date: houseRow.event_date, status: houseRow.status, house: houseParsed,
    params: (houseRow.params && typeof houseRow.params === 'object' && !Array.isArray(houseRow.params) ? houseRow.params : {}) as Record<string, unknown>,
  } : null

  // ── FX (AUD per unit) ──────────────────────────────────────────────────────
  const currencies = new Set(sel.cashflows.map(c => c.currency).filter(c => c !== 'AUD'))
  currencies.add('EUR')
  const fxInfo: Plan['fx'] = []
  const fx: Record<string, number> = {}
  for (const cur of currencies) {
    const stored = (fxRows ?? []).find(r => r.from_currency === cur)
    const choice = chooseRate(cur, stored ?? null)
    if (choice?.source === 'stored') { fx[cur] = choice.rate; fxInfo.push({ currency: cur, rate: choice.rate, date: choice.date, source: 'stored' }) }
    else if (cur === 'EUR') { fx[cur] = a.fx_eur_aud; fxInfo.push({ currency: cur, rate: a.fx_eur_aud, date: null, source: 'assumption' }) }
    else if (choice) { fx[cur] = choice.rate; fxInfo.push({ currency: cur, rate: choice.rate, date: null, source: 'fallback' }) }
  }

  const input: ProjectionInput = {
    today,
    startMonth: addMonths(thisMonth, 1),
    months: opts.months ?? 60,
    assumptions: a,
    accounts: projAccounts,
    people: projPeople,
    salaries: sel.salaries,
    netIncomes,
    spending,
    cashflows: sel.cashflows,
    events: projEvents,
    fx,
    sweepAccountId: chooseSweepAccount(projAccounts),
    depositAccountIds: (house && depositAccountIdsFromParams(house.params)) ?? defaultDepositAccountIds(projAccounts),
  }

  return {
    input,
    scenario: baseline ? { id: baseline.id, name: baseline.name } : null,
    assumptions: resolved,
    people: projPeople,
    salaryRows: sel.salaries.map(s => ({ ...s, frequency: freqOf.get(s.id) ?? 'annual' })),
    house,
    skipped: sel.skipped,
    fx: fxInfo,
    incomeNote,
  }
}

export type DepositGoal = GoalSolve & { eventName: string; currentCents: number }

/**
 * The headline goal: the house's upfront cash (deposit + costs) by the house
 * date. Run WITHOUT the purchase, so "when do we have the deposit?" isn't
 * confused by the deposit being spent.
 */
export function depositGoal(plan: Plan): DepositGoal | null {
  if (!plan.house) return null
  const byMonth = plan.house.date.slice(0, 7)
  const months = Math.max(plan.input.months, monthDiff(plan.input.startMonth, byMonth) + 1 + 120)
  const input: ProjectionInput = { ...plan.input, months: Math.min(months, 600), excludeEventKinds: ['house_purchase'] }
  const solve = solveGoal(input, 'depositPotCents', plan.house.house.upfrontCents, byMonth)
  const opening = plan.input.accounts.filter(x => plan.input.depositAccountIds.includes(x.id) || x.id === plan.input.sweepAccountId)
    .reduce((s, x) => s + x.balanceCents, 0)
  return { ...solve, eventName: plan.house.name, currentCents: opening }
}

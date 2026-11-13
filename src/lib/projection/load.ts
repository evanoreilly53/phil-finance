// Server-side loader: the only part of the projection that talks to Supabase.
// Fetches the household's rows once; buildPlan (plan.ts, pure) turns them
// into a projection input for any scenario.

import type { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { addMonths, perthMonthKey } from '@/lib/format'
import { perthToday } from '@/lib/import/dates'
import { getSetting } from '@/lib/settings'
import { BASELINE_EXCLUDE, spendingBaseline, type CashflowRow } from './inputs'
import { buildPlan, type AccountRow, type EventRow, type HouseholdMember, type Plan, type PlanData } from './plan'
import type { ScenarioRow } from './scenarios'

export { buildPlan, depositGoal, depositGoalInput, type DepositGoal, type HouseEvent, type Plan, type PlanData } from './plan'

type Supabase = Awaited<ReturnType<typeof createClient>>

const SPEND_MONTHS = 6

export async function fetchPlanData(supabase: Supabase): Promise<PlanData> {
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
    supabase.from('scenarios').select('id, name, description, is_baseline, parent_scenario_id, sort_order').eq('is_archived', false).order('sort_order').order('created_at'),
    supabase.from('assumptions').select('scenario_id, key, value'),
    supabase.from('life_events').select('id, scenario_id, name, kind, event_date, end_date, status, budget_cents, params').or('is_archived.eq.false,kind.eq.wedding').order('event_date'),
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

  const cats = (categories ?? []).map(c => ({ id: c.id, name: c.name, parent_id: c.parent_id, kind: c.kind }))
  const excludeRootIds = new Set(cats.filter(c => !c.parent_id && BASELINE_EXCLUDE.test(c.name)).map(c => c.id))
  const spending = spendingBaseline({ txs, categories: cats, budgets: budgets ?? [], months: spendMonths, budgetMonth: thisMonth, excludeRootIds })

  return {
    today, thisMonth,
    accounts: (accounts ?? []) as AccountRow[],
    snapshots,
    people: people ?? [],
    scenarios: (scenarios ?? []) as ScenarioRow[],
    assumptionRows: assumptionRows ?? [],
    events: (events ?? []) as EventRow[],
    cashflowRows: cashflowRows as CashflowRow[],
    spending,
    fxRows: fxRows ?? [],
    members: Array.isArray(members) ? members : [],
  }
}

export async function loadPlan(supabase: Supabase, opts: { months?: number; scenarioId?: string | null } = {}): Promise<Plan> {
  return buildPlan(await fetchPlanData(supabase), opts)
}


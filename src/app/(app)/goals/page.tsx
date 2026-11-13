import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import GoalsView, { type GoalProjection } from './GoalsView'
import { monthlyNetWorth, currentNetWorthCents } from '@/lib/balances'
import { loadPlan } from '@/lib/projection/load'
import { solveGoal } from '@/lib/projection/goals'
import { monthDiff } from '@/lib/projection/schedule'
import { cashflowToOutflow, type CashflowItemRow } from '@/lib/plannedItems'

export default async function GoalsPage() {
  const supabase = await createClient()

  const [{ data: goals }, { data: payments }, { data: categories }, snapshots, { data: accounts }, plan] = await Promise.all([
    supabase.from('goals').select('*').eq('is_active', true).order('sort_order'),
    // One-off payments live in planned_cashflows (what the projection reads). Wedding EUR balances stay on the Wedding page.
    supabase.from('planned_cashflows').select('id, description, kind, person_key, amount_cents, currency, frequency, start_date, status, category_id, account_id, notes, source_table')
      .eq('kind', 'expense').eq('frequency', 'once').is('scenario_id', null).eq('currency', 'AUD').neq('status', 'cancelled')
      .or('source_table.is.null,source_table.neq.wedding_items').order('start_date'),
    supabase.from('categories').select('id, name'),
    fetchAll((from, to) => supabase
      .from('account_snapshots')
      .select('account_id, aud_balance_cents, date')
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    supabase.from('accounts').select('id').eq('is_active', true),
    loadPlan(supabase),
  ])

  const catName = new Map((categories ?? []).map(c => [c.id, c.name]))
  const outflows = ((payments ?? []) as CashflowItemRow[]).map(r => cashflowToOutflow(r, id => catName.get(id)))

  // Same basis as the Net Worth page: active accounts, balances carried forward
  const accountIds = new Set((accounts ?? []).map(a => a.id))
  const currentNW  = currentNetWorthCents(snapshots, { accountIds })
  const monthlyNW  = monthlyNetWorth(snapshots, { accountIds }).map(m => ({ date: `${m.mk}-01`, nw: Math.round(m.cents / 100) }))

  // Net-worth goals: projected month + back-solved monthly gap, from the projection engine
  const projections: Record<string, GoalProjection> = {}
  for (const g of goals ?? []) {
    if ((g.kind !== 'net_worth_milestone' && g.kind !== 'net_worth_ultimate') || !g.target_date) continue
    const byMonth = g.target_date.slice(0, 7)
    const months = Math.min(600, Math.max(60, monthDiff(plan.input.startMonth, byMonth) + 121))
    const s = solveGoal({ ...plan.input, months }, 'netWorthCents', g.target_cents, byMonth)
    projections[g.id] = { projectedMonth: s.projectedMonth, monthsLate: s.monthsLate, extraMonthlyCents: s.extraMonthlyCents }
  }

  return (
    <GoalsView
      goals={goals ?? []}
      outflows={outflows}
      currentNW={currentNW}
      projections={projections}
      monthlyNWData={monthlyNW}
    />
  )
}

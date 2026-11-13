import Link from 'next/link'
import type { Route } from 'next'
import { ClipboardCheck, TrendingDown, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { fmtAUD, monthLabel, perthMonthKey, addMonths } from '@/lib/format'
import { currentNetWorthCents, monthlyNetWorth } from '@/lib/balances'
import { monthSummary, netWorthChange } from '@/lib/checkin'
import { loadPlan, depositGoal, type DepositGoal } from '@/lib/projection/load'
import { perthToday } from '@/lib/import/dates'
import DepositGoalCard from '@/components/DepositGoalCard'
import NWSparkline from './NWSparkline'
import DataHealth from './DataHealth'

// Home: the monthly money check-in. One hero number (net worth), one hero goal
// (house deposit with its projected date), this month vs budget, and the
// data-health prompts. Insights (Phase 4) get the slot below; nothing is faked.

export default async function DashboardPage() {
  const supabase = await createClient()
  const thisMonth = perthMonthKey()
  const nextMonth = addMonths(thisMonth, 1)
  const today = perthToday()

  const [snapshots, { data: accounts }, monthTxs, { data: categories }, { data: budgets }, { data: dueRecurring }, plan] = await Promise.all([
    fetchAll((from, to) => supabase.from('account_snapshots').select('account_id, aud_balance_cents, date')
      .order('date', { ascending: true }).order('id', { ascending: true }).range(from, to)),
    supabase.from('accounts').select('id').eq('is_active', true),
    fetchAll((from, to) => supabase.from('transactions').select('date, aud_amount_cents, category_id, is_transfer')
      .gte('date', `${thisMonth}-01`).lt('date', `${nextMonth}-01`).order('id').range(from, to)),
    supabase.from('categories').select('id, parent_id, kind'),
    supabase.from('budgets').select('category_id, monthly_cents, effective_from'),
    supabase.from('planned_cashflows').select('id', { count: 'exact' }).eq('status', 'planned').neq('frequency', 'once').is('scenario_id', null).eq('is_gross', false).is('event_id', null).eq('currency', 'AUD').lte('start_date', today),
    loadPlan(supabase).catch(() => null),
  ])

  // Net worth: active accounts, last known balance carried forward
  const activeIds = new Set((accounts ?? []).map(a => a.id))
  const nw = currentNetWorthCents(snapshots, { accountIds: activeIds })
  const monthly = monthlyNetWorth(snapshots, { accountIds: activeIds })
  const change = netWorthChange(monthly)
  const spark = monthly.slice(-12).map(m => ({ date: `${m.mk}-01`, total: m.cents }))

  const month = monthSummary(monthTxs, categories ?? [], budgets ?? [], thisMonth)
  let deposit: DepositGoal | null = null
  try { deposit = plan ? depositGoal(plan) : null } catch { deposit = null }

  const overBudget = month.budgetCents > 0 && month.spentCents > month.budgetCents
  const dueCount = (dueRecurring ?? []).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400 px-1">{monthLabel(thisMonth)} check-in</p>

      {/* Net worth hero */}
      <Link href={'/networth' as Route} className="block bg-gray-900 rounded-2xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Net worth</p>
        <div className="flex items-baseline gap-3 mt-1 flex-wrap">
          <p className="text-4xl font-bold text-white tabular-nums">{fmtAUD(nw)}</p>
          {change?.changeCents != null && (
            <span className={`flex items-center gap-1 text-sm ${change.changeCents >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {change.changeCents >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {fmtAUD(change.changeCents, { signed: true })} ({monthLabel(change.mk, { month: 'short' })})
            </span>
          )}
        </div>
        <NWSparkline points={spark} />
        <p className="text-[11px] text-gray-500">Last 12 months, balances carried forward</p>
      </Link>

      {/* Hero goal */}
      {deposit ? <DepositGoalCard goal={deposit} /> : (
        <Link href={'/more/assumptions' as Route} className="block bg-gray-900 rounded-2xl border border-gray-800 p-5 text-sm text-gray-400">
          Add your house plan in Assumptions to see the deposit date. →
        </Link>
      )}

      {/* This month */}
      <Link href={'/more/budgets' as Route} className="block bg-gray-900 rounded-2xl border border-gray-800 p-5 hover:border-gray-700 transition-colors">
        <p className="text-xs text-gray-500 uppercase tracking-wider">This month</p>
        <div className="mt-2 space-y-1.5 text-sm">
          <p className="text-gray-300">
            Spent <span className="text-white font-semibold tabular-nums">{fmtAUD(month.spentCents)}</span>
            {month.budgetCents > 0
              ? <> of <span className="tabular-nums">{fmtAUD(month.budgetCents)}</span> budget{overBudget && <span className="text-red-400"> · {fmtAUD(month.spentCents - month.budgetCents)} over</span>}</>
              : <span className="text-gray-500"> · no budgets set</span>}
          </p>
          {month.budgetCents > 0 && (
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden" aria-hidden="true">
              <div className={`h-full rounded-full ${overBudget ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, (month.spentCents / month.budgetCents) * 100)}%` }} />
            </div>
          )}
          {month.savedPct !== null ? (
            <p className="text-gray-300">
              Saved <span className={`font-semibold tabular-nums ${month.savedCents >= 0 ? 'text-white' : 'text-red-400'}`}>{fmtAUD(month.savedCents, { signed: month.savedCents < 0 })}</span>
              <span className="text-gray-500"> ({Math.round(month.savedPct * 100)}% of {fmtAUD(month.incomeCents)} in)</span>
            </p>
          ) : <p className="text-xs text-gray-500">No pay recorded this month yet.</p>}
          <p className="text-[11px] text-gray-500">Transfers between your accounts aren&apos;t counted.</p>
        </div>
      </Link>

      {/* Check-in slot: the insights engine arrives in Phase 4 */}
      <section className="bg-gray-900/60 rounded-2xl border border-dashed border-gray-800 p-4 flex items-start gap-3">
        <ClipboardCheck size={16} className="text-gray-600 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-gray-500">
          <p className="text-gray-400">Check-in</p>
          <p>Up to three ranked things worth a look will appear here once the insights engine lands.</p>
          {dueCount > 0 && <p className="mt-1"><Link href={'/settings' as Route} className="text-indigo-400">{dueCount} recurring item{dueCount === 1 ? '' : 's'} due to post →</Link></p>}
        </div>
      </section>

      {/* Review queue prompt + data freshness strip */}
      <DataHealth />
    </div>
  )
}

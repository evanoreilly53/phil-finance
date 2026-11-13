import Link from 'next/link'
import type { Route } from 'next'
import dynamic from 'next/dynamic'
import { AlertTriangle, SlidersHorizontal, Target } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fmtAUD, fmtCompact, fmtDate, monthLabel } from '@/lib/format'
import { loadPlan, depositGoal } from '@/lib/projection/load'
import { runProjection } from '@/lib/projection/engine'
import { solveGoal } from '@/lib/projection/goals'
import { chartSeries } from '@/lib/projection/present'
import { monthDiff } from '@/lib/projection/schedule'
import { dayDiff } from '@/lib/import/dates'
import ChartSkeleton from '@/components/ChartSkeleton'
import DepositGoalCard from '@/components/DepositGoalCard'
import MonthLedger from './MonthLedger'

const FutureChart = dynamic(() => import('./FutureChart'), { loading: () => <ChartSkeleton height={260} /> })

const HORIZONS = [5, 10, 30] as const
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>
const mon = (mk: string) => monthLabel(mk, { month: 'short', year: 'numeric' })

export default async function FuturePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const yearsParam = Number(params.years)
  const years = (HORIZONS as readonly number[]).includes(yearsParam) ? yearsParam : 5

  const supabase = await createClient()
  const [plan, { data: goals }] = await Promise.all([
    loadPlan(supabase, { months: years * 12 }),
    supabase.from('goals').select('id, name, kind, target_cents, current_cents, target_date').eq('is_active', true).order('sort_order'),
  ])
  const projection = runProjection(plan.input)
  const deposit = depositGoal(plan)
  const points = chartSeries(projection)
  const labelOf = new Map(points.map(p => [p.month, p.label]))
  const pins = plan.input.events
    .filter(e => e.status !== 'cancelled' && labelOf.has(e.date.slice(0, 7)))
    .map(e => ({ month: e.date.slice(0, 7), label: labelOf.get(e.date.slice(0, 7))!, name: e.name, done: e.status === 'done' }))

  const selectedParam = typeof params.m === 'string' ? params.m : null
  const selected = selectedParam && projection.months.some(x => x.month === selectedParam) ? selectedParam : null

  // Net-worth goals from the Goals list, solved against the same plan
  const nwGoals = (goals ?? []).filter(g => (g.kind === 'net_worth_milestone' || g.kind === 'net_worth_ultimate') && g.target_date).map(g => {
    const byMonth = g.target_date!.slice(0, 7)
    const months = Math.min(600, Math.max(60, monthDiff(plan.input.startMonth, byMonth) + 121))
    return { goal: g, solve: solveGoal({ ...plan.input, months }, 'netWorthCents', g.target_cents, byMonth) }
  })
  const oldHouseGoal = (goals ?? []).find(g => /house|deposit/i.test(g.name) && g.target_date)

  const last = projection.months[projection.months.length - 1]
  const lowest = projection.months.reduce((lo, m) => (m.liquidCents < lo.liquidCents ? m : lo), projection.months[0])
  const stale = plan.input.accounts.filter(a => a.balanceAsOf && dayDiff(a.balanceAsOf, plan.input.today) > 35)
  const a = plan.assumptions

  return (
    <div className="space-y-4">
      {/* Scenario + horizon */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" aria-label="Scenario">
          <span className="text-xs px-3 py-1.5 rounded-full bg-indigo-600 text-white">{plan.scenario ? 'Baseline' : 'Defaults'}</span>
          <span className="text-xs px-3 py-1.5 rounded-full border border-dashed border-gray-700 text-gray-500" title="Named scenarios and side-by-side comparison arrive in Phase 3">Compare: soon</span>
        </div>
        <nav aria-label="Horizon" className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {HORIZONS.map(y => (
            <Link key={y} href={`/future?years=${y}${selected ? `&m=${selected}` : ''}` as Route} aria-current={y === years ? 'page' : undefined}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${y === years ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {y} yrs
            </Link>
          ))}
        </nav>
      </div>

      {/* Chart */}
      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
        <div className="flex items-baseline justify-between mb-2 gap-3">
          <p className="text-sm font-semibold text-white">Where you&apos;re heading</p>
          {last && <p className="text-xs text-gray-400 tabular-nums">{mon(last.month)}: {fmtCompact(last.netWorthCents)} net worth</p>}
        </div>
        <FutureChart points={points} pins={pins} years={years} selected={selected} />
        <form action="/future" className="flex items-center gap-2 mt-3">
          <input type="hidden" name="years" value={years} />
          <label htmlFor="m" className="text-xs text-gray-400">Open month</label>
          <select id="m" name="m" defaultValue={selected ?? ''} className="bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 px-2 py-1.5">
            <option value="" disabled>Choose…</option>
            {projection.months.map(m => <option key={m.month} value={m.month}>{mon(m.month)}{m.pins.length ? ` · ${m.pins.map(p => p.name).join(', ')}` : ''}</option>)}
          </select>
          <button className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:text-white">Show</button>
        </form>
      </section>

      {selected && <MonthLedger projection={projection} month={selected} />}

      {/* Goals */}
      <section className="space-y-2">
        <h2 className="text-xs text-gray-500 uppercase tracking-wider px-1">Goals</h2>
        {deposit ? <DepositGoalCard goal={deposit} href={`/future?years=${years}&m=${deposit.byMonth}#ledger`} /> : (
          <p className="bg-gray-900 rounded-2xl border border-gray-800 p-5 text-sm text-gray-400">No house purchase in the plan. Add one in <Link href={'/more/assumptions' as Route} className="text-indigo-400">Assumptions</Link>.</p>
        )}
        {oldHouseGoal && deposit && oldHouseGoal.target_date!.slice(0, 7) !== deposit.byMonth && (
          <p className="text-xs text-amber-300/90 px-1">
            Your Goals list says &ldquo;{oldHouseGoal.name}&rdquo; by {fmtDate(oldHouseGoal.target_date!, { month: 'short', year: 'numeric' })}, but the plan&apos;s house date is {mon(deposit.byMonth)}.
            {' '}<Link href={'/more/assumptions' as Route} className="underline">Pick one in Assumptions</Link>.
          </p>
        )}
        {nwGoals.map(({ goal, solve }) => (
          <div key={goal.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-4 flex items-start gap-3">
            <Target size={16} className="text-gray-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              <p className="text-white">{goal.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Net worth {fmtCompact(goal.target_cents)} by {mon(solve.byMonth)} ·{' '}
                {solve.projectedMonth === 'now' ? 'reached' : solve.projectedMonth ? `projected ${mon(solve.projectedMonth)}` : 'not reached in 50 years'}
                {solve.extraMonthlyCents ? ` · +${fmtAUD(solve.extraMonthlyCents)}/mo closes the gap` : ''}
                {solve.extraMonthlyCents === null && solve.projectedMonth !== 'now' ? ' · target date has passed' : ''}
              </p>
            </div>
          </div>
        ))}
        <Link href={'/goals' as Route} className="block text-xs text-indigo-400 px-1">All goals and payments →</Link>
      </section>

      {/* Events */}
      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider">Life events</h2>
          <Link href={'/more/assumptions' as Route} className="text-xs text-indigo-400">Edit →</Link>
        </div>
        {plan.input.events.length === 0 ? <p className="text-sm text-gray-400">None yet.</p> : (
          <ul className="space-y-2">
            {plan.input.events.filter(e => e.status !== 'cancelled').map(e => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white">{e.name}{e.status === 'done' && <span className="ml-2 text-[10px] text-green-400">done</span>}</span>
                <span className="text-gray-400 text-xs flex-shrink-0 tabular-nums">
                  {mon(e.date.slice(0, 7))}
                  {e.house && ` · ${fmtCompact(e.house.priceCents)}, ${fmtCompact(e.house.upfrontCents)} upfront`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What this projection assumes */}
      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider">What this assumes</h2>
          <Link href={'/more/assumptions' as Route} className="flex items-center gap-1 text-xs text-indigo-400"><SlidersHorizontal size={12} /> Assumptions</Link>
        </div>
        <ul className="space-y-1.5 text-gray-300 text-xs">
          <li><span className="text-gray-500">Income:</span> {plan.incomeNote}</li>
          <li>
            <span className="text-gray-500">Spending:</span> {fmtAUD(plan.input.spending.totalMonthlyCents)}/mo
            {' '}(budget where you&apos;ve set one, otherwise the average of {mon(plan.input.spending.months[0])}–{mon(plan.input.spending.months[plan.input.spending.months.length - 1])}; transfers, wedding and one-offs left out), rising {a.inflation_pct.value}% a year.
          </li>
          <li><span className="text-gray-500">Growth:</span> savings {a.cash_return_pct.value}%, investments {a.investment_return_pct.value}%, super {a.super_return_pct.value}%, homes {a.house_price_growth_pct.value}%, mortgage {a.mortgage_rate_pct.value}%, pay {a.wage_growth_pct.value}% a year.</li>
          <li><span className="text-gray-500">Savings collect in:</span> {projection.accounts.find(x => x.id === projection.sweepAccountId)?.name}</li>
          {plan.fx.map(f => (
            <li key={f.currency}><span className="text-gray-500">{f.currency}:</span> {f.rate} AUD{f.date ? ` (ECB, ${fmtDate(f.date, { day: 'numeric', month: 'short' })})` : ' (assumption)'}</li>
          ))}
          {lowest && <li><span className="text-gray-500">Lowest cash:</span> {fmtAUD(lowest.liquidCents, { signed: lowest.liquidCents < 0 })} in {mon(lowest.month)}</li>}
          {projection.extrapolatedFys.length > 0 && (
            <li><span className="text-gray-500">Tax:</span> {projection.extrapolatedFys[0]} onwards reuses the latest known tax tables (no bracket indexation).</li>
          )}
        </ul>

        {(projection.warnings.length > 0 || stale.length > 0) && (
          <ul className="space-y-1.5">
            {stale.length > 0 && (
              <li className="flex gap-2 text-xs text-amber-300"><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Starting balances are old for {stale.map(s => `${s.name} (${fmtDate(s.balanceAsOf!, { day: 'numeric', month: 'short' })})`).join(', ')}: the projection assumes no change since.
              </li>
            )}
            {projection.warnings.map(w => (
              <li key={w} className="flex gap-2 text-xs text-amber-300"><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{w}</li>
            ))}
          </ul>
        )}

        {plan.skipped.length > 0 && (
          <details className="text-xs">
            <summary className="text-gray-400 cursor-pointer">{plan.skipped.length} planned item{plan.skipped.length === 1 ? '' : 's'} not included</summary>
            <ul className="mt-2 space-y-1">
              {plan.skipped.map(s => <li key={s.id} className="text-gray-400"><span className="text-gray-200">{s.description}</span>: {s.reason}</li>)}
            </ul>
          </details>
        )}
        <p className="text-[11px] text-gray-500">A model of your own numbers, shown to the month. Not financial advice.</p>
      </section>
    </div>
  )
}

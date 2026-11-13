import Link from 'next/link'
import type { Route } from 'next'
import dynamic from 'next/dynamic'
import { AlertTriangle, SlidersHorizontal, Target } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fmtAUD, fmtCompact, fmtDate, monthLabel } from '@/lib/format'
import { fetchPlanData, buildPlan, depositGoal, type Plan } from '@/lib/projection/load'
import { summariseScenario, diffAssumptions, diffHouse, type ScenarioSummary } from '@/lib/projection/scenarios'
import { ScenarioChips } from '@/components/planUi'
import WhatIf from './WhatIf'
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

  const sid = typeof params.s === 'string' ? params.s : null
  const compareIds = (Array.isArray(params.compare) ? params.compare : typeof params.compare === 'string' ? params.compare.split(',') : []).filter(Boolean).slice(0, 3)

  const supabase = await createClient()
  const [data, { data: goals }] = await Promise.all([
    fetchPlanData(supabase),
    supabase.from('goals').select('id, name, kind, target_cents, current_cents, target_date').eq('is_active', true).order('sort_order'),
  ])
  const plan = buildPlan(data, { scenarioId: sid, months: years * 12 })
  const sq = plan.scenario && !plan.scenario.isBaseline ? `&s=${plan.scenario.id}` : ''
  const projection = runProjection(plan.input)
  const atMonth = `${Number(plan.input.today.slice(0, 4)) + 4}-12`
  const houseOf = (p: Plan) => (p.house ? { date: p.house.date, params: p.house.house } : null)

  // Side by side: two or three ticked scenarios, each built from the same fetched rows.
  const baselinePlan = plan.scenario?.isBaseline ? plan : buildPlan(data, { months: years * 12 })
  const compared = compareIds.length >= 2
    ? compareIds.map(id => buildPlan(data, { scenarioId: id, months: years * 12 })).filter((p, i, all) => all.findIndex(q => q.scenario?.id === p.scenario?.id) === i)
    : []
  const summaries = compared.map(p => ({
    plan: p,
    sum: summariseScenario(p.input, houseOf(p), atMonth),
    diffs: [
      ...diffAssumptions(baselinePlan.assumptions, p.assumptions).map(d => `${d.label} ${d.from} → ${d.to}`),
      ...diffHouse(houseOf(baselinePlan), houseOf(p)).map(d => `${d.field} ${d.from} → ${d.to}`),
      ...p.leaves.filter(l => l.scenarioId).map(l => `${l.name}, ${mon(l.date.slice(0, 7))}–${mon(l.endDate.slice(0, 7))}`),
    ],
  }))
  const sc = (c: number) => `${c < 0 ? '−' : ''}${fmtCompact(c)}`
  const compareRows: [string, (s: ScenarioSummary) => string][] = [
    ['Buy', s => (s.houseMonth ? `${mon(s.houseMonth)}, ${fmtCompact(s.priceCents ?? 0)}` : 'No purchase')],
    ['Upfront cash', s => (s.upfrontCents !== null ? fmtCompact(s.upfrontCents) : '—')],
    ['Duty, fees, LMI − grants', s => (s.costsCents !== null ? sc(s.costsCents) : '—')],
    ['Deposit ready', s => (s.depositReadyMonth === 'now' ? 'Now' : s.depositReadyMonth ? `${mon(s.depositReadyMonth)}${s.depositMonthsLate && s.depositMonthsLate > 0 ? ` (${s.depositMonthsLate} mo late)` : ''}` : 'Not reached')],
    ['Loan', s => (s.loanCents !== null ? fmtCompact(s.loanCents) : '—')],
    ['Repayment', s => (s.monthlyRepaymentCents ? `${fmtAUD(s.monthlyRepaymentCents)}/mo` : '—')],
    [`Net worth ${mon(atMonth)}`, s => (s.netWorthAtCents !== null ? sc(s.netWorthAtCents) : '—')],
    [`Cash ${mon(atMonth)}`, s => (s.liquidAtCents !== null ? sc(s.liquidAtCents) : '—')],
    ['Lowest cash', s => (s.lowestCash ? `${sc(s.lowestCash.cents)} (${mon(s.lowestCash.month)})` : '—')],
    [`Mortgage interest to ${mon(atMonth)}`, s => (s.interestToAtCents ? fmtCompact(s.interestToAtCents) : '—')],
  ]
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
        <div className="min-w-0 flex-1">
          <ScenarioChips scenarios={plan.scenarios} currentId={plan.scenario?.id ?? null} basePath="/future" keep={{ years: String(years) }} manageHref="/future/scenarios" />
        </div>
        <nav aria-label="Horizon" className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {HORIZONS.map(y => (
            <Link key={y} href={`/future?years=${y}${sq}${selected ? `&m=${selected}` : ''}` as Route} aria-current={y === years ? 'page' : undefined}
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
        <FutureChart points={points} pins={pins} years={years} selected={selected} query={sq} />
        <form action="/future" className="flex items-center gap-2 mt-3">
          <input type="hidden" name="years" value={years} />
          {sq && <input type="hidden" name="s" value={plan.scenario!.id} />}
          <label htmlFor="m" className="text-xs text-gray-400">Open month</label>
          <select id="m" name="m" defaultValue={selected ?? ''} className="bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 px-2 py-1.5">
            <option value="" disabled>Choose…</option>
            {projection.months.map(m => <option key={m.month} value={m.month}>{mon(m.month)}{m.pins.length ? ` · ${m.pins.map(p => p.name).join(', ')}` : ''}</option>)}
          </select>
          <button className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:text-white">Show</button>
        </form>
      </section>

      {selected && <MonthLedger projection={projection} month={selected} />}

      <WhatIf input={plan.input} house={houseOf(plan)} scenarioId={plan.scenario?.id ?? null}
        scenarioName={plan.scenario && !plan.scenario.isBaseline ? `“${plan.scenario.name}”` : 'the baseline'} atMonth={atMonth} />

      {/* Side-by-side comparison */}
      {plan.scenarios.length > 1 && (
        <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3" id="compare">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider">Compare scenarios</h2>
          <form action="/future#compare" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="years" value={years} />
            {sq && <input type="hidden" name="s" value={plan.scenario!.id} />}
            {[...plan.scenarios].sort((x, y) => Number(y.is_baseline) - Number(x.is_baseline)).map(s => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs text-gray-300 border border-gray-700 rounded-full px-3 py-1.5">
                <input type="checkbox" name="compare" value={s.id} defaultChecked={compareIds.includes(s.id)} className="accent-indigo-500" />
                {s.is_baseline ? 'Baseline' : s.name}
              </label>
            ))}
            <button className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:text-white">Compare</button>
          </form>
          {summaries.length < 2 ? <p className="text-xs text-gray-500">Tick two or three scenarios.</p> : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[22rem]">
                <thead>
                  <tr className="text-[11px]">
                    <th className="text-left font-normal py-1 px-1"><span className="sr-only">Measure</span></th>
                    {summaries.map(({ plan: p }) => <th key={p.scenario?.id} className="text-right font-medium text-white py-1 px-1">{p.scenario?.isBaseline ? 'Baseline' : p.scenario?.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {compareRows.map(([label, f]) => (
                    <tr key={label}>
                      <td className="py-1.5 px-1 text-gray-400 text-xs">{label}</td>
                      {summaries.map(({ plan: p, sum }) => <td key={p.scenario?.id} className="py-1.5 px-1 text-right tabular-nums text-gray-200">{f(sum)}</td>)}
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 px-1 text-gray-400 text-xs align-top">Differs from baseline</td>
                    {summaries.map(({ plan: p, diffs }) => (
                      <td key={p.scenario?.id} className="py-1.5 px-1 text-right text-[11px] text-gray-400 align-top">{diffs.length ? diffs.map(d => <span key={d} className="block">{d}</span>) : '—'}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

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

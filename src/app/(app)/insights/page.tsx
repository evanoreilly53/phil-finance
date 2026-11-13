import Link from 'next/link'
import type { Route } from 'next'
import { Inbox, CalendarClock, ListChecks, PiggyBank, TrendingUp, Lightbulb } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { addMonths, fmtAUD, fmtDate, monthLabel } from '@/lib/format'
import { addDays } from '@/lib/import/dates'
import { budgetsForMonth, spendByCategory } from '@/lib/budgets'
import { budgetPace } from '@/lib/budgetPace'
import { explainNetWorth, monthSummary } from '@/lib/checkin'
import { loadCheckin } from '@/lib/insights/load'
import { monthsWithData, spendHistory, spendRoots } from '@/lib/insights/history'
import { upcomingBills, visibleSubscriptions } from '@/lib/subscriptions/bills'
import { MAX_SHOWN } from '@/lib/insights/rank'
import InsightCard from '@/components/InsightCard'
import { Caveat, Panel } from '@/components/planUi'
import BudgetPaceList from './BudgetPaceList'
import RestoreButton from './RestoreButton'

// The monthly check-in (was Insights): a ten-minute ritual on the 1st.
// 1 clear the review queue · 2 what happened last month · 3 this month's
// budgets · 4 up to three things worth a look · 5 bills coming up.
// The old health score and advice cards are retired.

const WHY_LABEL = { done: 'Done this month', snoozed: 'Snoozed', intentional: 'Intentional' } as const

export default async function CheckinPage() {
  const supabase = await createClient()
  const data = await loadCheckin(supabase, { recordLog: true })
  const { ctx, ranked, plan } = data
  const { today, thisMonth } = ctx
  const lastMonth = addMonths(thisMonth, -1)
  const since = addDays(today, -90)

  const [snapshots, { data: accounts }, { count: reviewCount }, { data: planned }] = await Promise.all([
    fetchAll((from, to) => supabase.from('account_snapshots').select('account_id, aud_balance_cents, date').order('date').order('id').range(from, to)),
    supabase.from('accounts').select('id, name').eq('is_active', true).order('sort_order').order('name'),
    supabase.from('transactions').select('id', { count: 'exact', head: true })
      .or(`needs_review.eq.true,and(category_id.is.null,is_transfer.eq.false,date.gte.${since})`),
    supabase.from('planned_cashflows').select('id, description, amount_cents, currency, frequency, start_date')
      .eq('status', 'planned').eq('kind', 'expense').neq('frequency', 'once').is('scenario_id', null).is('event_id', null),
  ])

  // 2. Last month
  const last = monthSummary(ctx.transactions, ctx.categories, ctx.budgets, lastMonth)
  const nw = explainNetWorth({ month: lastMonth, snapshots, accounts: accounts ?? [], txs: ctx.transactions, categories: ctx.categories })
  const lastTargets = budgetsForMonth(ctx.budgets, lastMonth)
  const lastSpend = spendByCategory(ctx.transactions, lastMonth, ctx.categories, { rollup: true })
  const roots = spendRoots(ctx.categories)
  const lastOver = roots.filter(c => (lastTargets.get(c.id) ?? 0) > 0).map(c => ({ c, target: lastTargets.get(c.id)!, spent: lastSpend.get(c.id) ?? 0 }))

  // 3. This month's budgets (pace + suggestions from the last 6 complete months with data)
  const data6 = monthsWithData(ctx.transactions)
  const hist = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, -6 + i)).filter(m => data6.has(m))
  const histSpend = spendHistory(ctx, hist)
  const pace = budgetPace({
    categories: roots,
    targets: budgetsForMonth(ctx.budgets, thisMonth),
    spent: spendByCategory(ctx.transactions, thisMonth, ctx.categories, { rollup: true }),
    history: new Map(roots.map(c => [c.id, hist.map(m => histSpend.get(m)!.get(c.id) ?? 0)])),
    today,
  })

  // 5. Bills
  const subs = visibleSubscriptions(ctx.subscriptions, ctx.subscriptionMarks)
  const bills = upcomingBills({
    subscriptions: ctx.subscriptions, marks: ctx.subscriptionMarks, today, days: 14,
    planned: (planned ?? []).map(r => ({ id: r.id, description: r.description, amountCents: r.amount_cents, currency: r.currency, frequency: r.frequency as Exclude<typeof r.frequency, 'once'>, nextDue: r.start_date })),
    fx: Object.fromEntries(plan.fx.map(f => [f.currency, f.rate])),
  })
  const subsMonthly = [...subs.untracked, ...subs.tracked].reduce((s, x) => s + x.monthlyCents, 0)

  return (
    <div className="space-y-4 pb-4">
      <div className="px-1">
        <p className="text-white text-lg font-semibold">{monthLabel(thisMonth)} check-in</p>
        <p className="text-xs text-gray-500">About ten minutes: clear the queue, see what happened, look at up to {MAX_SHOWN} things, done.</p>
      </div>

      {/* 1. Review queue */}
      <Panel title="1 · Review queue" icon={<Inbox size={14} />}>
        {(reviewCount ?? 0) > 0 ? (
          <Link href={'/transactions/review' as Route} className="flex items-center justify-between text-sm text-amber-200">
            <span>{reviewCount} transaction{reviewCount === 1 ? '' : 's'} need a look</span><span className="text-xs text-amber-300">Review →</span>
          </Link>
        ) : <p className="text-sm text-green-300">All clear: nothing waiting for a category or a decision.</p>}
      </Panel>

      {/* 2. What happened last month */}
      <Panel title={`2 · What happened in ${monthLabel(lastMonth, { month: 'long' })}`} icon={<TrendingUp size={14} />}>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-[11px] text-gray-500">Money in</dt><dd className="text-white tabular-nums font-semibold">{fmtAUD(last.incomeCents)}</dd></div>
          <div><dt className="text-[11px] text-gray-500">Spent</dt><dd className="text-white tabular-nums font-semibold">{fmtAUD(last.spentCents)}</dd>
            {last.budgetCents > 0 && <dd className="text-[11px] text-gray-500">of {fmtAUD(last.budgetCents)} budget</dd>}</div>
          <div><dt className="text-[11px] text-gray-500">Saved</dt><dd className={`tabular-nums font-semibold ${last.savedCents >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtAUD(last.savedCents, { signed: last.savedCents < 0 })}</dd>
            {last.savedPct !== null && <dd className="text-[11px] text-gray-500">{Math.round(last.savedPct * 100)}% of money in</dd>}</div>
        </dl>

        {lastOver.length > 0 && (
          <ul className="text-xs space-y-1">
            {lastOver.map(({ c, target, spent }) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span className="text-gray-400">{c.name}</span>
                <span className={`tabular-nums ${spent > target ? 'text-red-300' : 'text-gray-300'}`}>{fmtAUD(spent)} / {fmtAUD(target)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-gray-800 pt-3 space-y-2">
          <p className="text-sm text-gray-300">
            Net worth {nw.changeCents >= 0 ? 'rose' : 'fell'} <span className={`font-semibold tabular-nums ${nw.changeCents >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtAUD(nw.changeCents, { signed: true })}</span>
            <span className="text-gray-500"> ({fmtAUD(nw.startCents)} → {fmtAUD(nw.endCents)})</span>
          </p>
          <ul className="text-xs space-y-1">
            {nw.rows.map(r => (
              <li key={r.key}>
                <div className="flex justify-between gap-3"><span className="text-gray-400">{r.label}</span><span className="tabular-nums text-gray-200">{fmtAUD(r.cents, { signed: true })}</span></div>
                {r.detail && <p className="text-[11px] text-gray-500">{r.detail}</p>}
              </li>
            ))}
          </ul>
          {nw.accounts.length > 0 && (
            <details className="text-xs">
              <summary className="text-gray-400 cursor-pointer">By account</summary>
              <ul className="mt-2 space-y-1">
                {nw.accounts.map(a => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span className="text-gray-400 truncate">{a.name}{!a.updated && <span className="text-gray-600"> · not updated</span>}</span>
                    <span className="tabular-nums text-gray-300">{fmtAUD(a.changeCents, { signed: true })}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Caveat>Month-end balances, each account&apos;s last known balance carried forward. The rows add up to the change exactly. <Link href={'/future' as Route} className="text-indigo-400">The projection&apos;s month ledger</Link> shows the same split for months ahead.</Caveat>
        </div>
      </Panel>

      {/* 3. This month's budgets */}
      <Panel title="3 · Budgets this month" icon={<PiggyBank size={14} />} aside={<Link href={'/more/budgets' as Route} className="text-xs text-indigo-400">Edit →</Link>}>
        <BudgetPaceList lines={pace} />
      </Panel>

      {/* 4. Insights */}
      <Panel title={`4 · Worth a look (${ranked.shown.length} of ${MAX_SHOWN})`} icon={<Lightbulb size={14} />}>
        {ranked.shown.length === 0
          ? <p className="text-sm text-gray-400">Nothing stands out this month.</p>
          : <ul className="space-y-2">{ranked.shown.map(i => <InsightCard key={i.key} insight={i} today={today} canSave={data.statesAvailable} />)}</ul>}
        {ranked.more.length > 0 && (
          <details id="all" className="scroll-mt-20">
            <summary className="text-xs text-indigo-400 cursor-pointer">See all ({ranked.more.length} more, smaller $ impact)</summary>
            <ul className="space-y-2 mt-2">{ranked.more.map(i => <InsightCard key={i.key} insight={i} today={today} canSave={data.statesAvailable} />)}</ul>
          </details>
        )}
        {ranked.hidden.length > 0 && (
          <details className="text-xs">
            <summary className="text-gray-400 cursor-pointer">Done, snoozed or intentional ({ranked.hidden.length})</summary>
            <ul className="mt-2 space-y-1.5">
              {ranked.hidden.map(h => (
                <li key={h.insight.key} className="flex items-center justify-between gap-3">
                  <span className="text-gray-400 min-w-0"><span className="text-gray-500">{WHY_LABEL[h.why]}{h.until ? ` until ${fmtDate(h.until)}` : ''}:</span> {h.insight.title}</span>
                  <RestoreButton insightKey={h.insight.key} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {ranked.errors.length > 0 && <p className="text-[11px] text-amber-300/80">Some checks couldn&apos;t run: {ranked.errors.map(e => e.rule).join(', ')}.</p>}
        <Caveat>Ranked by dollar impact, at most {MAX_SHOWN} a month; end-of-financial-year items go first from April to June. &ldquo;Deposit days&rdquo; come from re-running the projection with the change. Patterns in your own numbers, not advice or product recommendations.</Caveat>
      </Panel>

      {/* 5. Bills */}
      <Panel title="5 · Bills in the next two weeks" icon={<CalendarClock size={14} />} aside={<Link href={'/track/bills' as Route} className="text-xs text-indigo-400">Bills →</Link>}>
        {bills.length === 0 ? <p className="text-sm text-gray-400">Nothing due in the next 14 days.</p> : (
          <ul className="text-xs space-y-1">
            {bills.slice(0, 8).map(b => (
              <li key={`${b.ref}${b.date}`} className="flex justify-between gap-3">
                <span className="text-gray-400 truncate">{fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {b.label}</span>
                <span className="tabular-nums text-gray-300">{fmtAUD(b.cents, { full: true })}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-gray-500 flex items-center gap-1"><ListChecks size={12} /> {subs.untracked.length + subs.tracked.length} subscriptions found, about {fmtAUD(subsMonthly)}/mo.</p>
      </Panel>
    </div>
  )
}

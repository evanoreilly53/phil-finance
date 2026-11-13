'use server'

// Monthly PDF report (Phase 5): loads the household's rows and assembles the
// report data (pure, src/lib/report/monthly.ts). The PDF itself is drawn in
// the browser, so nothing here depends on fonts or a PDF library at runtime.

import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { loadCheckin, plannedSacrificeThisFy, grossByPerson } from '@/lib/insights/load'
import { upcomingBills, visibleSubscriptions } from '@/lib/subscriptions/bills'
import { superCapLines } from '@/lib/superCap'
import { homeLoanStatus, isLoanMode } from '@/lib/house/homeLoan'
import { buildMonthlyReport, isReportMonth, type MonthlyReport } from '@/lib/report/monthly'

export async function getMonthlyReport(month: string): Promise<{ report?: MonthlyReport; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  try {
    const data = await loadCheckin(supabase)
    const { ctx, ranked, plan, deposit, concessionalRows } = data
    const { today, thisMonth } = ctx
    if (!isReportMonth(month, thisMonth)) return { error: 'Pick a month from the last two years' }

    const [snapshots, { data: accounts }, { data: planned }] = await Promise.all([
      fetchAll((from, to) => supabase.from('account_snapshots').select('account_id, aud_balance_cents, date').order('date').order('id').range(from, to)),
      supabase.from('accounts').select('id, name').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('planned_cashflows').select('id, description, amount_cents, currency, frequency, start_date')
        .eq('status', 'planned').eq('kind', 'expense').neq('frequency', 'once').is('scenario_id', null).is('event_id', null),
    ])

    const subs = visibleSubscriptions(ctx.subscriptions, ctx.subscriptionMarks)
    const bills = upcomingBills({
      subscriptions: ctx.subscriptions, marks: ctx.subscriptionMarks, today, days: 14,
      planned: (planned ?? []).map(r => ({ id: r.id, description: r.description, amountCents: r.amount_cents, currency: r.currency, frequency: r.frequency as Exclude<typeof r.frequency, 'once'>, nextDue: r.start_date })),
      fx: Object.fromEntries(plan.fx.map(f => [f.currency, f.rate])),
    })
    const gross = grossByPerson(plan, today)
    const capLines = superCapLines(
      plan.people.map(p => ({ key: p.key, name: p.name, grossCents: gross.get(p.key) ?? 0, hasPrivateHospital: p.hasPrivateHospital, hasHecs: p.hasHecs, plannedSacrificeCents: plannedSacrificeThisFy(plan, p.key) })),
      concessionalRows, today,
    )
    const h = plan.house
    const homeLoan = h && isLoanMode(h, thisMonth)
      ? homeLoanStatus({ thisMonth, accounts: plan.input.accounts, house: { date: h.date, status: h.status, params: h.house }, mortgageRatePct: plan.input.assumptions.mortgage_rate_pct })
      : null

    const report = buildMonthlyReport({
      month, today,
      generatedAt: new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
      txs: ctx.transactions, categories: ctx.categories, budgets: ctx.budgets,
      snapshots, accounts: accounts ?? [],
      insights: [...ranked.shown, ...ranked.more],
      subscriptions: [...subs.untracked, ...subs.tracked],
      bills,
      deposit,
      sacrifice: (plan.input.sacrifice ?? []).map(s => ({ name: plan.people.find(p => p.key === s.personKey)?.name ?? s.personKey, annualCents: s.annualCents })),
      fhssOn: plan.fhss.on,
      capLines,
      homeLoan,
    })
    return { report }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The report could not be made' }
  }
}

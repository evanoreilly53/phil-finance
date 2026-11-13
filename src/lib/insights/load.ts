// Server-side loader for the monthly check-in: the only part of the insights
// engine that talks to Supabase. Builds the InsightContext from the household's
// rows, runs the engine, and records this month's deposit projection in
// checkin_log (first visit of the month only) for next month's goal drift.
// Every Phase 4 table read degrades quietly if migration 0010 hasn't run.

import type { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { addMonths } from '@/lib/format'
import { addDays } from '@/lib/import/dates'
import { fetchPlanData, buildPlan, depositGoal, depositGoalInput, type DepositGoal, type Plan } from '@/lib/projection/load'
import { loadAccountFreshness, type AccountFreshness } from '@/lib/freshnessData'
import { fhssProjectionMonths, fhssTimeline } from '@/lib/house/fhss'
import { detectSubscriptions, type Subscription } from '@/lib/subscriptions/detect'
import type { SubscriptionMark } from '@/lib/subscriptions/bills'
import { CONCESSIONAL_SOURCE, contributionsInFy, type ConcessionalRow } from '@/lib/superCap'
import type { BudgetRow } from '@/lib/budgets'
import { runInsights } from './index'
import type { Ranked } from './rank'
import type { InsightAccount, InsightCategory, InsightContext, InsightPerson, InsightStateRow, InsightTx, RuleId } from './types'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type CheckinData = {
  plan: Plan
  deposit: DepositGoal | null
  ctx: InsightContext
  ranked: Ranked & { errors: { rule: RuleId; message: string }[] }
  states: InsightStateRow[]
  /** False until migration 0010 has run (Done / Snooze / Intentional can't be saved). */
  statesAvailable: boolean
  freshness: AccountFreshness[]
  concessionalRows: ConcessionalRow[]
}

/**
 * The plan's salary sacrifice (More › Assumptions) still to come this FY: the
 * yearly amount for the months from the first projected month to 30 June.
 */
export function plannedSacrificeThisFy(plan: Plan, personKey: string): number {
  const annual = Math.round((plan.personAssumptions[personKey]?.salary_sacrifice.value ?? 0) * 100)
  if (annual <= 0) return 0
  const start = plan.input.startMonth
  const m = Number(start.slice(5, 7))
  const monthsLeft = m >= 7 ? 19 - m : 7 - m // first projected month through June
  return Math.round(annual * monthsLeft / 12)
}

/** Current gross salary per person (from the plan's salary rows). */
export function grossByPerson(plan: Plan, today: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of plan.salaryRows) {
    if (s.endDate && s.endDate < today) continue
    if (s.startDate > today) continue
    out.set(s.personKey, (out.get(s.personKey) ?? 0) + s.grossAnnualCents)
  }
  return out
}

export async function loadStates(supabase: Supabase): Promise<{ rows: (InsightStateRow & { scope: string; ref_id: string | null })[]; available: boolean }> {
  try {
    const { data, error } = await supabase.from('insight_states').select('key, scope, state, done_month, snooze_until, ref_id')
    if (error) return { rows: [], available: false }
    return { rows: data ?? [], available: true }
  } catch {
    return { rows: [], available: false }
  }
}

export function subscriptionMarks(rows: readonly { scope: string; key: string; state: string; ref_id: string | null }[]): SubscriptionMark[] {
  return rows.filter(r => r.scope === 'subscription' && (r.state === 'tracked' || r.state === 'dismissed'))
    .map(r => ({ key: r.key, state: r.state as 'tracked' | 'dismissed', refId: r.ref_id }))
}

export async function loadCheckin(supabase: Supabase, opts: { recordLog?: boolean } = {}): Promise<CheckinData> {
  const data = await fetchPlanData(supabase)
  const plan = buildPlan(data, { months: 60 })
  const { today, thisMonth } = data
  let deposit: DepositGoal | null = null
  try { deposit = depositGoal(plan) } catch { deposit = null }

  const since = `${addMonths(thisMonth, -25)}-01`
  const [txs, { data: categories }, { data: budgets }, freshness, states, prevLog, plannedRows] = await Promise.all([
    fetchAll((from, to) => supabase.from('transactions')
      .select('id, date, description, amount_cents, aud_amount_cents, currency, category_id, is_transfer, account_id')
      .gte('date', since).order('date').order('id').range(from, to)),
    supabase.from('categories').select('id, name, parent_id, kind'),
    supabase.from('budgets').select('category_id, monthly_cents, effective_from'),
    loadAccountFreshness(supabase).catch(() => [] as AccountFreshness[]),
    loadStates(supabase),
    (async () => {
      try {
        const { data: rows, error } = await supabase.from('checkin_log').select('month, deposit_projected_month').lt('month', thisMonth).order('month', { ascending: false }).limit(1)
        return error ? null : rows?.[0] ?? null
      } catch { return null }
    })(),
    fetchAll((from, to) => supabase.from('planned_cashflows')
      .select('id, description, kind, person_key, amount_cents, currency, frequency, start_date, end_date, status, source_table, scenario_id')
      .is('scenario_id', null).neq('status', 'cancelled').order('start_date').order('id').range(from, to)).catch(() => []),
  ])

  const transactions = txs as InsightTx[]
  const freshById = new Map(freshness.map(f => [f.id, f]))
  const accounts: InsightAccount[] = plan.input.accounts.filter(a => !a.synthetic).map(a => ({
    id: a.id, name: a.name, type: a.type, currency: a.currency, balanceCents: a.balanceCents, balanceAsOf: a.balanceAsOf,
    interestRatePct: a.interestRatePct, dataAsOf: freshById.get(a.id)?.dataAsOf ?? a.balanceAsOf,
  }))

  const concessionalRows = plannedRows
    .filter(r => r.kind === 'super_contribution' && r.source_table === CONCESSIONAL_SOURCE)
    .map(r => ({ id: r.id, person_key: r.person_key, amount_cents: r.amount_cents, frequency: r.frequency, start_date: r.start_date, end_date: r.end_date, status: r.status, description: r.description })) as ConcessionalRow[]
  const gross = grossByPerson(plan, today)
  const people: InsightPerson[] = plan.people.map(p => ({
    key: p.key, name: p.name, grossCents: gross.get(p.key) ?? 0, hasPrivateHospital: p.hasPrivateHospital, hasHecs: p.hasHecs,
    voluntaryConcessionalCents: contributionsInFy(concessionalRows, p.key, today).reduce((s, e) => s + e.cents, 0)
      + plannedSacrificeThisFy(plan, p.key),
  }))

  const eurRate = plan.fx.find(f => f.currency === 'EUR')?.rate ?? plan.input.assumptions.fx_eur_aud
  const subscriptions: Subscription[] = detectSubscriptions(transactions.filter(t => t.date >= addDays(today, -400)), today)
  const h = plan.house
  const ctx: InsightContext = {
    today, thisMonth, transactions,
    categories: (categories ?? []) as InsightCategory[],
    budgets: (budgets ?? []) as BudgetRow[],
    accounts,
    cashRatePct: plan.input.assumptions.cash_return_pct,
    monthlySpendCents: plan.input.spending.totalMonthlyCents,
    deposit: deposit ? {
      eventId: h?.id ?? null, eventName: deposit.eventName, projectedMonth: deposit.projectedMonth, byMonth: deposit.byMonth,
      monthsLate: deposit.monthsLate, extraMonthlyCents: deposit.extraMonthlyCents, targetCents: deposit.targetCents,
    } : null,
    previousCheckin: prevLog ? { month: prevLog.month, depositProjectedMonth: prevLog.deposit_projected_month } : null,
    house: h ? { eventName: h.name, date: h.date, priceCents: h.house.priceCents, cashCents: h.house.upfrontCents, firstHome: h.house.firstHome, kind: h.house.propertyKind, useScheme: h.house.useScheme } : null,
    people,
    fhssReleaseMonth: h ? fhssTimeline(h.date.slice(0, 7), today).requestBy : null,
    fhssMonths: h && h.status === 'planned' && h.house.firstHome && fhssProjectionMonths(h.date.slice(0, 7)).requestMonth > plan.input.startMonth
      ? fhssProjectionMonths(h.date.slice(0, 7)) : null,
    fhssOn: plan.fhss.on,
    subscriptions,
    subscriptionMarks: subscriptionMarks(states.rows),
    plannedEur: plannedRows.filter(r => r.currency === 'EUR' && r.kind === 'expense' && r.status === 'planned')
      .map(r => ({ description: r.description, nativeCents: r.amount_cents, date: r.start_date })),
    eurAudRate: eurRate,
  }

  const insightStates = states.rows.filter(r => r.scope === 'insight')
  const ranked = runInsights({ ctx, states: insightStates, depositInput: depositGoalInput(plan), depositTargetCents: deposit?.targetCents ?? null })

  if (opts.recordLog && states.available) await recordCheckin(supabase, thisMonth, deposit, h?.id ?? null).catch(() => {})

  return { plan, deposit, ctx, ranked, states: insightStates, statesAvailable: states.available, freshness, concessionalRows }
}

/** First visit of the month writes its deposit projection; later visits leave it alone. */
async function recordCheckin(supabase: Supabase, month: string, deposit: DepositGoal | null, eventId: string | null) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('checkin_log').upsert({
    month, deposit_event_id: eventId,
    deposit_projected_month: deposit?.projectedMonth ?? null,
    deposit_target_month: deposit?.byMonth ?? null,
    deposit_target_cents: deposit?.targetCents ?? null,
    created_by: user.id,
  }, { onConflict: 'month', ignoreDuplicates: true })
}

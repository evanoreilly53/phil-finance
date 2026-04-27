import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { fmtAUD, fmtDate, perthMonthKey, addMonths, daysUntilPerth } from '@/lib/format'
import type { Route } from 'next'
import AdviceCards, { type AdviceCard } from '@/components/AdviceCards'
import { getSetting } from '@/lib/settings'

export default async function DashboardPage() {
  const supabase = await createClient()
  const thisMonth = perthMonthKey()
  const prevMonth = addMonths(thisMonth, -1)
  const nextMonth = addMonths(thisMonth, 1)
  const perthToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date())
  const d30 = new Date(`${perthToday}T00:00:00`)
  d30.setDate(d30.getDate() + 30)
  const in30Days = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, '0')}-${String(d30.getDate()).padStart(2, '0')}`

  const [
    { data: snapshots },
    { data: accounts },
    { data: thisMonthTxs },
    { data: prevMonthTxs },
    { data: outflows },
    { data: weddingItems },
    { data: investSnaps },
    { data: dueRecurring },
    MONTHLY_INCOME_CENTS,
    PERSONAL_BUDGET_CENTS,
    weddingBudgetCents,
  ] = await Promise.all([
    supabase.from('account_snapshots').select('account_id, aud_balance_cents, date').order('date', { ascending: false }),
    supabase.from('accounts').select('id, is_liquid, type').eq('is_active', true),
    supabase.from('transactions').select('aud_amount_cents, owner').lt('aud_amount_cents', 0).gte('date', `${thisMonth}-01`).lt('date', `${nextMonth}-01`),
    supabase.from('transactions').select('aud_amount_cents').lt('aud_amount_cents', 0).gte('date', `${prevMonth}-01`).lt('date', `${thisMonth}-01`),
    supabase.from('planned_outflows').select('description, amount_cents, due_date, status').eq('status', 'planned').order('due_date').limit(5),
    supabase.from('wedding_items').select('budget_aud_cents, spent_aud_cents, status'),
    supabase.from('account_snapshots')
      .select('account_id, aud_balance_cents, date')
      .order('date', { ascending: false })
      .limit(50),
    supabase.from('recurring_transactions')
      .select('id, description, amount_cents, next_due')
      .eq('is_active', true)
      .lte('next_due', perthToday)
      .order('next_due')
      .limit(5),
    getSetting<number>('monthly_income_cents',  1256300),
    getSetting<number>('personal_budget_cents', 80000),
    getSetting<number>('wedding_budget_cents',  7500000),
  ])

  // Net worth
  const liquidIds  = new Set((accounts ?? []).filter(a => a.is_liquid).map(a => a.id))
  const investIds  = new Set((accounts ?? []).filter(a => a.type === 'investment').map(a => a.id))
  const latestByAccount: Record<string, { cents: number; date: string }> = {}
  for (const s of snapshots ?? []) {
    if (!latestByAccount[s.account_id] || s.date > latestByAccount[s.account_id].date) {
      latestByAccount[s.account_id] = { cents: s.aud_balance_cents, date: s.date }
    }
  }
  const nw          = Object.values(latestByAccount).reduce((s, v) => s + v.cents, 0)
  const liquidBal   = Object.entries(latestByAccount)
    .filter(([id]) => liquidIds.has(id))
    .reduce((s, [, v]) => s + v.cents, 0)

  // Spending
  const thisSpend   = (thisMonthTxs ?? []).reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
  const prevSpend   = (prevMonthTxs ?? []).reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
  const spendChange = prevSpend > 0 ? ((thisSpend - prevSpend) / prevSpend * 100) : null

  // Personal allowance spending this month
  const rachelSpend = (thisMonthTxs ?? []).filter(t => t.owner === 'rachel').reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
  const evanSpend   = (thisMonthTxs ?? []).filter(t => t.owner === 'evan').reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)

  // Wedding
  const weddingBudget    = weddingBudgetCents
  const weddingSpent     = (weddingItems ?? []).reduce((s, i) => s + (i.spent_aud_cents ?? 0), 0)
  const weddingEstimate  = (weddingItems ?? []).reduce((s, i) => s + (i.budget_aud_cents ?? 0), 0)
  const weddingRemaining = weddingBudget - weddingSpent

  // Next payment
  const nextOutflow = (outflows ?? [])[0] ?? null
  const nextDays    = nextOutflow ? daysUntilPerth(nextOutflow.due_date) : null

  // 12.6 Cash-flow forecast: liquid balance − upcoming outflows in 30 days
  const upcoming30 = (outflows ?? []).filter(o => o.due_date >= perthToday && o.due_date <= in30Days)
  const outflow30Total = upcoming30.reduce((s, o) => s + o.amount_cents, 0)
  const projectedLiquid = liquidBal - outflow30Total

  // 12.4 Advice cards
  const advice: AdviceCard[] = []
  const savingsRate = Math.round(((MONTHLY_INCOME_CENTS - thisSpend) / MONTHLY_INCOME_CENTS) * 100)
  if (savingsRate < 10 && thisSpend > 0) {
    advice.push({
      id:    'savings-low',
      type:  'warning',
      title: `Savings rate: ${savingsRate}%`,
      body:  `Spending ${fmtAUD(thisSpend)} this month leaves only ${savingsRate}% of income ($${Math.round(MONTHLY_INCOME_CENTS/100).toLocaleString()}/mo). Aim for 20%+.`,
    })
  }
  if (weddingEstimate > weddingBudget) {
    advice.push({
      id:    'wedding-over',
      type:  'warning',
      title: 'Wedding estimate over budget',
      body:  `Current estimate ${fmtAUD(weddingEstimate)} exceeds the $75k ceiling by ${fmtAUD(weddingEstimate - weddingBudget)}. Review items on the Wedding page.`,
    })
  }
  if (rachelSpend > PERSONAL_BUDGET_CENTS) {
    advice.push({
      id:    'allowance-rachel',
      type:  'info',
      title: "Rachel's allowance over budget",
      body:  `${fmtAUD(rachelSpend)} spent vs ${fmtAUD(PERSONAL_BUDGET_CENTS)} monthly budget (${fmtAUD(rachelSpend - PERSONAL_BUDGET_CENTS)} over).`,
    })
  }
  if (evanSpend > PERSONAL_BUDGET_CENTS) {
    advice.push({
      id:    'allowance-evan',
      type:  'info',
      title: "Evan's allowance over budget",
      body:  `${fmtAUD(evanSpend)} spent vs ${fmtAUD(PERSONAL_BUDGET_CENTS)} monthly budget (${fmtAUD(evanSpend - PERSONAL_BUDGET_CENTS)} over).`,
    })
  }
  // Investment performance advice
  for (const id of investIds) {
    const snaps = (investSnaps ?? []).filter(s => s.account_id === id).sort((a, b) => a.date.localeCompare(b.date))
    const last  = snaps[snaps.length - 1]
    const prev  = snaps[snaps.length - 2]
    if (last && prev && prev.aud_balance_cents > 0) {
      const chg = ((last.aud_balance_cents - prev.aud_balance_cents) / prev.aud_balance_cents) * 100
      if (chg < -5) {
        const acctName = (accounts ?? []).find(a => a.id === id)
        advice.push({
          id:    `invest-drop-${id}`,
          type:  'warning',
          title: `Investment down ${Math.abs(chg).toFixed(1)}%`,
          body:  `${acctName ? 'An investment account' : 'An investment'} fell ${Math.abs(chg).toFixed(1)}% since the last snapshot. Review your allocation on the Net Worth page.`,
        })
      }
    }
  }

  const summaryCards: { label: string; sub: string; value: string; detail: string | null; colour: string; href: Route }[] = [
    {
      label: 'This month',
      sub: 'Spending',
      value: thisSpend > 0 ? fmtAUD(thisSpend) : '—',
      detail: spendChange !== null ? `${spendChange > 0 ? '+' : ''}${spendChange.toFixed(0)}% vs last month` : null,
      colour: spendChange !== null && spendChange > 10 ? 'text-red-400' : 'text-gray-500',
      href: '/spending',
    },
    {
      label: 'Net Worth',
      sub: 'Total',
      value: nw > 0 ? fmtAUD(nw) : '—',
      detail: '$250k goal',
      colour: 'text-gray-500',
      href: '/networth',
    },
    {
      label: 'Wedding',
      sub: 'Remaining',
      value: fmtAUD(weddingRemaining),
      detail: `${fmtAUD(weddingSpent)} spent`,
      colour: 'text-gray-500',
      href: '/wedding',
    },
    {
      label: nextOutflow?.description ?? 'No payments',
      sub: 'Next payment',
      value: nextOutflow ? fmtAUD(nextOutflow.amount_cents) : '—',
      detail: nextDays !== null ? (nextDays <= 0 ? 'overdue' : `in ${nextDays}d`) : null,
      colour: nextDays !== null && nextDays <= 30 ? 'text-yellow-400' : 'text-gray-500',
      href: '/goals',
    },
  ]

  return (
    <div className="space-y-4">
      {/* Net worth hero */}
      <Link href="/networth">
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 active:opacity-80">
          <p className="text-gray-400 text-sm">Total Net Worth</p>
          <p className="text-4xl font-bold text-white mt-1">{nw > 0 ? fmtAUD(nw) : '—'}</p>
          <p className="text-gray-500 text-xs mt-1">tap to see breakdown →</p>
        </div>
      </Link>

      {/* Advice cards (dismissible, client-side) */}
      {advice.length > 0 && <AdviceCards cards={advice} />}

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-3">
        {summaryCards.map(({ label, sub, value, detail, colour, href }) => (
          <Link key={label} href={href}>
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 active:opacity-80 h-full">
              <p className="text-gray-400 text-xs">{sub}</p>
              <p className="text-white font-semibold mt-1 text-lg leading-tight">{value}</p>
              {detail && <p className={`text-xs mt-1 ${colour}`}>{detail}</p>}
              <p className="text-gray-400 text-xs mt-0.5 truncate">{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* 12.6 Cash-flow forecast */}
      {liquidBal > 0 && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 px-4 py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">30-Day Liquid Forecast</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Liquid balance now</p>
              <p className="text-lg font-semibold text-white">{fmtAUD(liquidBal)}</p>
            </div>
            {outflow30Total > 0 && (
              <>
                <div className="text-gray-600 text-sm">−</div>
                <div>
                  <p className="text-sm text-gray-400">Due in 30d</p>
                  <p className="text-lg font-semibold text-yellow-300">{fmtAUD(outflow30Total)}</p>
                </div>
                <div className="text-gray-600 text-sm">=</div>
                <div className="text-right">
                  <p className="text-sm text-gray-400">Projected</p>
                  <p className={`text-lg font-semibold ${projectedLiquid < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {fmtAUD(projectedLiquid)}
                  </p>
                </div>
              </>
            )}
            {outflow30Total === 0 && (
              <p className="text-xs text-gray-500">No payments due in 30 days</p>
            )}
          </div>
        </div>
      )}

      {/* 13.1 Recurring due to confirm */}
      {(dueRecurring ?? []).length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <p className="text-yellow-300 text-sm font-medium">Due to Post</p>
            <Link href={'/settings' as import('next').Route} className="text-xs text-indigo-400 hover:text-indigo-300">Manage →</Link>
          </div>
          <div className="divide-y divide-yellow-800/30">
            {(dueRecurring ?? []).map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-white">{r.description}</p>
                  <p className="text-xs text-yellow-400/70 mt-0.5">Due {r.next_due}</p>
                </div>
                <p className="text-sm font-medium text-white tabular-nums">{fmtAUD(r.amount_cents, { signed: true })}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 px-4 pb-3">Go to Settings → Recurring to post these</p>
        </div>
      )}

      {/* Upcoming payments */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <p className="text-gray-400 text-sm font-medium">Upcoming Payments</p>
          <Link href="/goals" className="text-xs text-indigo-400 hover:text-indigo-300">See all →</Link>
        </div>
        {(outflows ?? []).length === 0 ? (
          <p className="text-gray-400 text-sm px-4 pb-4">No planned payments</p>
        ) : (
          <div className="divide-y divide-gray-800">
            {(outflows ?? []).slice(0, 4).map(o => {
              const days = daysUntilPerth(o.due_date)
              return (
                <div key={o.due_date + o.description} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm text-white">{o.description}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{fmtDate(o.due_date, { day: 'numeric', month: 'short' })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-white tabular-nums">{fmtAUD(o.amount_cents)}</p>
                    <p className={`text-xs mt-0.5 ${days <= 0 ? 'text-red-400' : days <= 30 ? 'text-yellow-400' : 'text-gray-500'}`}>
                      {days <= 0 ? 'overdue' : days === 0 ? 'today' : `${days}d`}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

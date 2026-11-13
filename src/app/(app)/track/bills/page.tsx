import { CalendarDays } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { fmtAUD, fmtDate } from '@/lib/format'
import { addDays, perthToday } from '@/lib/import/dates'
import { chooseRate } from '@/lib/fx'
import { detectSubscriptions, DETECT } from '@/lib/subscriptions/detect'
import { billCalendar, upcomingBills, visibleSubscriptions } from '@/lib/subscriptions/bills'
import { loadStates, subscriptionMarks } from '@/lib/insights/load'
import TrackTabs from '@/components/TrackTabs'
import { Caveat, Panel } from '@/components/planUi'
import SubscriptionList from './SubscriptionList'

const DAYS = 35
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default async function BillsPage() {
  const supabase = await createClient()
  const today = perthToday()
  const [txs, { data: categories }, { data: planned }, { data: fxRow }, states] = await Promise.all([
    fetchAll((from, to) => supabase.from('transactions').select('id, date, description, aud_amount_cents, category_id, is_transfer')
      .gte('date', addDays(today, -400)).lt('aud_amount_cents', 0).eq('is_transfer', false).order('date').order('id').range(from, to)),
    supabase.from('categories').select('id, name'),
    supabase.from('planned_cashflows').select('id, description, amount_cents, currency, frequency, start_date, source_table')
      .eq('status', 'planned').eq('kind', 'expense').neq('frequency', 'once').is('scenario_id', null).is('event_id', null),
    supabase.from('fx_rates').select('rate, date').eq('from_currency', 'EUR').eq('to_currency', 'AUD').order('date', { ascending: false }).limit(1).maybeSingle(),
    loadStates(supabase),
  ])

  const subs = detectSubscriptions(txs, today)
  const marks = subscriptionMarks(states.rows)
  const v = visibleSubscriptions(subs, marks)
  const eur = chooseRate('EUR', fxRow ?? null)?.rate ?? 1.65
  const plannedRec = (planned ?? []).map(r => ({ id: r.id, description: r.description, amountCents: r.amount_cents, currency: r.currency, frequency: r.frequency as Exclude<typeof r.frequency, 'once'>, nextDue: r.start_date }))
  const bills = upcomingBills({ subscriptions: subs, marks, planned: plannedRec, today, days: DAYS, fx: { EUR: eur } })
  const weeks = billCalendar(bills, today, DAYS)
  const catName = new Map((categories ?? []).map(c => [c.id, c.name]))
  const live = [...v.untracked, ...v.tracked]
  const monthly = live.reduce((s, x) => s + x.monthlyCents, 0)
  const next30 = bills.filter(b => b.date <= addDays(today, 30)).reduce((s, b) => s + b.cents, 0)

  const toRow = (s: (typeof subs)[number]) => ({
    key: s.key, merchant: s.merchant, description: s.description, cadence: s.cadence, amountCents: s.amountCents, monthlyCents: s.monthlyCents,
    lastSeen: s.lastSeen, nextDue: s.nextDue, isNew: s.isNew, active: s.active, priceChange: s.priceChange, count: s.count,
    categoryId: s.categoryId, category: s.categoryId ? catName.get(s.categoryId) ?? null : null,
  })

  return (
    <div className="space-y-4">
      <TrackTabs />

      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Bills &amp; subscriptions</p>
        <p className="text-2xl font-bold text-white tabular-nums mt-1">{fmtAUD(monthly)}<span className="text-sm font-normal text-gray-500">/mo in {live.length} subscription{live.length === 1 ? '' : 's'}</span></p>
        <p className="text-xs text-gray-400 mt-1">{fmtAUD(next30)} of bills due in the next 30 days (subscriptions and recurring items).</p>
      </section>

      <Panel title="Next five weeks" icon={<CalendarDays size={14} />}>
        <div role="grid" aria-label="Bills calendar" className="space-y-1">
          <div className="grid grid-cols-7 gap-1 text-[10px] text-gray-500 text-center" role="row">
            {WEEKDAYS.map((d, i) => <span key={i} role="columnheader">{d}</span>)}
          </div>
          {weeks.map(w => (
            <div key={w[0].date} className="grid grid-cols-7 gap-1" role="row">
              {w.map(d => {
                const total = d.bills.reduce((s, b) => s + b.cents, 0)
                return (
                  <div key={d.date} role="gridcell" aria-label={`${fmtDate(d.date)}${d.bills.length ? `: ${d.bills.map(b => b.label).join(', ')}` : ''}`}
                    className={`rounded-lg min-h-12 p-1 text-[10px] ${!d.inRange ? 'opacity-30' : d.date === today ? 'bg-indigo-500/15 border border-indigo-500/40' : d.bills.length ? 'bg-gray-800' : 'bg-gray-800/40'}`}>
                    <p className="text-gray-400">{Number(d.date.slice(8, 10))}</p>
                    {d.inRange && d.bills.length > 0 && <p className="text-white tabular-nums font-medium leading-tight">{fmtAUD(total)}</p>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        {bills.length === 0 ? <p className="text-sm text-gray-400">No bills found for the next five weeks.</p> : (
          <ul className="text-xs space-y-1 border-t border-gray-800 pt-3">
            {bills.map(b => (
              <li key={`${b.ref}|${b.date}`} className="flex justify-between gap-3">
                <span className="text-gray-400 truncate">{fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {b.label}
                  <span className="text-gray-600"> · {b.source === 'detected' ? 'found in transactions' : 'planned item'}</span></span>
                <span className="tabular-nums text-gray-300 whitespace-nowrap">{fmtAUD(b.cents, { full: true })}{b.currency !== 'AUD' ? ` (${b.currency} ${(b.nativeCents / 100).toFixed(2)})` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SubscriptionList
        untracked={v.untracked.map(toRow)}
        tracked={v.tracked.map(toRow)}
        dismissed={v.dismissed.map(toRow)}
        ended={subs.filter(s => !s.active && !marks.some(m => m.key === s.key)).map(toRow)}
        canSave={states.available}
      />

      <Caveat>
        A subscription is the same merchant charging a steady amount on a regular cycle (weekly to yearly), found in the last 13 months of transactions; transfers are ignored.
        Monthly charges need {3} or more payments. A charge is &ldquo;new&rdquo; if it first appeared in the last {DETECT.newWithinDays} days.
        &ldquo;Track as planned item&rdquo; adds it to Settings › Recurring, marked as already in your spending, so the projection doesn&apos;t count it twice.
      </Caveat>
    </div>
  )
}

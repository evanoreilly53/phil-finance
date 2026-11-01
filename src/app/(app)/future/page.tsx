import Link from 'next/link'
import type { Route } from 'next'
import { CalendarClock, Target } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveAssumptions, ASSUMPTIONS, type AssumptionKey } from '@/lib/assumptions'
import { fmtAUD, fmtDate, fmtEUR } from '@/lib/format'

export default async function FuturePage() {
  const supabase = await createClient()
  const [{ data: scenarios }, { data: assumptions }, { data: events }, { data: cashflows }] = await Promise.all([
    supabase.from('scenarios').select('id, name, description, is_baseline, parent_scenario_id').eq('is_archived', false).order('sort_order'),
    supabase.from('assumptions').select('scenario_id, key, value'),
    supabase.from('life_events').select('id, name, kind, event_date, status, currency, budget_cents').eq('is_archived', false).neq('status', 'cancelled').order('event_date'),
    supabase.from('planned_cashflows').select('id, description, amount_cents, currency, frequency, start_date, status').eq('status', 'planned').order('start_date').limit(8),
  ])

  const baseline = (scenarios ?? []).find(s => s.is_baseline) ?? null
  const resolved = baseline ? resolveAssumptions(baseline.id, scenarios ?? [], assumptions ?? []) : null

  return (
    <div className="space-y-4">
      <div className="bg-indigo-950/40 border border-indigo-900 rounded-2xl p-5 space-y-2">
        <div className="flex items-center gap-2 text-indigo-300 text-sm font-medium"><CalendarClock size={16} /> Coming in Phase 2</div>
        <p className="text-sm text-gray-300">
          A month-by-month projection of every account: net worth and cash out to 2030, your events as pins on the timeline,
          and the date your house deposit is ready. It will run on the plan below.
        </p>
      </div>

      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Base case</p>
        {baseline ? (
          <>
            <p className="text-white font-medium">{baseline.name}</p>
            {baseline.description && <p className="text-xs text-gray-400">{baseline.description}</p>}
            {resolved && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-1">
                {(Object.keys(ASSUMPTIONS) as AssumptionKey[]).map(k => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-gray-500">{ASSUMPTIONS[k].label}</dt>
                    <dd className="text-gray-200 tabular-nums">{ASSUMPTIONS[k].unit === 'pct' ? `${resolved[k].value}%` : resolved[k].value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-[11px] text-gray-500">Estimates for modelling, not advice. Editable on the Assumptions screen in Phase 2.</p>
          </>
        ) : (
          <p className="text-sm text-gray-400">No baseline yet. Run migration 0008 to create it.</p>
        )}
      </section>

      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Life events</p>
        {(events ?? []).length === 0 ? <p className="text-sm text-gray-400">None yet.</p> : (
          <ul className="space-y-2">
            {(events ?? []).map(e => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white">{e.name}{e.status === 'done' && <span className="ml-2 text-[10px] text-green-400">done</span>}</span>
                <span className="text-gray-400 text-xs flex-shrink-0">
                  {fmtDate(e.event_date, { month: 'short', year: 'numeric' })}
                  {e.budget_cents != null && ` · ${e.currency === 'EUR' ? fmtEUR(e.budget_cents) : fmtAUD(e.budget_cents)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(cashflows ?? []).length > 0 && (
        <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Planned payments</p>
          <ul className="space-y-2">
            {(cashflows ?? []).map(c => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-200 truncate">{c.description}</span>
                <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                  {c.currency === 'EUR' ? fmtEUR(c.amount_cents) : fmtAUD(c.amount_cents)}
                  {c.frequency !== 'once' ? ` / ${c.frequency}` : ` · ${fmtDate(c.start_date, { day: 'numeric', month: 'short', year: '2-digit' })}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href={'/goals' as Route} className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium bg-gray-900 border border-gray-800 text-gray-300 hover:text-white">
        <Target size={15} /> Goals (today&apos;s page)
      </Link>
    </div>
  )
}

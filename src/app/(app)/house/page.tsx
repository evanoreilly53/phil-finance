import { House } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fmtAUD, fmtDate } from '@/lib/format'

type HouseParams = { price_cents?: number; deposit_cents?: number; state?: string; first_home_buyer?: boolean }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export default async function HousePage() {
  const supabase = await createClient()
  const { data: event } = await supabase.from('life_events')
    .select('name, event_date, params, notes')
    .eq('kind', 'house_purchase').is('scenario_id', null).neq('status', 'cancelled')
    .order('event_date').limit(1).maybeSingle()

  const p = (event?.params ?? {}) as HouseParams
  const price = num(p.price_cents)
  const deposit = num(p.deposit_cents)

  return (
    <div className="space-y-4">
      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
        <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wider"><House size={14} /> The plan</div>
        {event ? (
          <>
            <p className="text-white text-lg font-semibold">{event.name}</p>
            <dl className="grid grid-cols-3 gap-3">
              <div><dt className="text-[11px] text-gray-500">Price</dt><dd className="text-white font-medium tabular-nums">{price != null ? fmtAUD(price) : '—'}</dd></div>
              <div><dt className="text-[11px] text-gray-500">Deposit + costs</dt><dd className="text-white font-medium tabular-nums">{deposit != null ? fmtAUD(deposit) : '—'}</dd></div>
              <div><dt className="text-[11px] text-gray-500">Target</dt><dd className="text-white font-medium">{fmtDate(event.event_date, { month: 'short', year: 'numeric' })}</dd></div>
            </dl>
            {event.notes && <p className="text-xs text-gray-500">{event.notes}</p>}
          </>
        ) : (
          <p className="text-sm text-gray-400">No house plan yet. Run migration 0008 to add the base case (~$1M, $250k deposit, 2028).</p>
        )}
      </section>

      <div className="bg-indigo-950/40 border border-indigo-900 rounded-2xl p-5 space-y-2">
        <p className="text-indigo-300 text-sm font-medium">Coming in Phase 3</p>
        <ul className="text-sm text-gray-300 list-disc pl-5 space-y-1">
          <li>Price explorer with WA transfer duty, the first-home cliffs and the 5% scheme cap</li>
          <li>Indicative borrowing power</li>
          <li>FHSS vs saving in cash, each of you</li>
          <li>Mortgage and offset after you buy</li>
        </ul>
        <p className="text-[11px] text-gray-500">Estimates only, not advice. Figures will be checked against RevenueWA and the ATO first.</p>
      </div>
    </div>
  )
}

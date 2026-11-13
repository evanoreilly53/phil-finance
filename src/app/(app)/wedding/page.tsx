import { createClient } from '@/lib/supabase/server'
import WeddingView from './WeddingView'
import WeddingArchive from './WeddingArchive'
import ArchiveButton from './ArchiveButton'
import { getSetting } from '@/lib/settings'
import { weddingArchiveState } from '@/lib/wedding'

export default async function WeddingPage() {
  const supabase = await createClient()

  const [{ data: items }, { data: fxRows }, weddingBudgetCents, { data: event }] = await Promise.all([
    supabase.from('wedding_items').select('*').order('sort_order'),
    supabase
      .from('fx_rates')
      .select('rate, date')
      .eq('from_currency', 'EUR')
      .eq('to_currency', 'AUD')
      .order('date', { ascending: false })
      .limit(400),
    getSetting<number>('wedding_budget_cents', 7500000),
    supabase.from('life_events').select('id, name, event_date, is_archived, params').eq('kind', 'wedding').order('created_at').limit(1).maybeSingle(),
  ])

  const eurToAud = fxRows?.[0]?.rate ?? 1.65
  const budgetAud = Math.round(weddingBudgetCents / 100)
  const state = weddingArchiveState(items ?? [], event ?? null)

  if (state.archived) {
    const rates = (fxRows ?? []).map(r => Number(r.rate)).filter(Number.isFinite)
    return (
      <WeddingArchive
        name={event?.name ?? 'Our Wedding 2026'}
        date={event?.event_date ?? null}
        items={items ?? []}
        budgetCents={weddingBudgetCents}
        state={state}
        fx={{ latest: eurToAud, latestDate: fxRows?.[0]?.date ?? null, low: rates.length ? Math.min(...rates) : null, high: rates.length ? Math.max(...rates) : null, from: fxRows?.at(-1)?.date ?? null }}
        hasEvent={!!event}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 px-4 py-3 flex items-center justify-between gap-3 text-xs">
        <span className="text-gray-400">
          {state.allPaid ? 'Everything is paid. Archive it as a read-only record?' : `${state.openItems} item${state.openItems === 1 ? '' : 's'} still to pay. It archives itself once everything is paid.`}
        </span>
        {event && <ArchiveButton archive label={state.allPaid ? 'Archive' : 'Archive anyway'} />}
      </div>
      <WeddingView items={items ?? []} budget={budgetAud} eurToAud={eurToAud} />
    </div>
  )
}

import Link from 'next/link'
import type { Route } from 'next'
import { Heart, Archive } from 'lucide-react'
import { fmtAUD, fmtDate, fmtEUR } from '@/lib/format'
import type { WeddingArchiveState } from '@/lib/wedding'
import type { WeddingItem } from './WeddingView'
import ArchiveButton from './ArchiveButton'

const STATUS: Record<string, string> = { paid: 'Paid', deposit_paid: 'Deposit', pending: 'Pending', cancelled: 'Cancelled' }

/** Read-only "Our Wedding 2026": budget vs actual, EUR/AUD history and the total cost in AUD. */
export default function WeddingArchive({ name, date, items, budgetCents, state, fx, hasEvent }: {
  name: string
  date: string | null
  items: WeddingItem[]
  budgetCents: number
  state: WeddingArchiveState
  fx: { latest: number; latestDate: string | null; low: number | null; high: number | null; from: string | null }
  hasEvent: boolean
}) {
  const t = state.totals
  const diff = t.spentAudCents - budgetCents
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 px-1">
        <Archive size={13} /> More › Archive · read-only
      </div>

      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-2">
        <p className="flex items-center gap-2 text-white font-semibold"><Heart size={15} className="text-pink-400" />{name}</p>
        {date && <p className="text-xs text-gray-500">{fmtDate(date, { day: 'numeric', month: 'long', year: 'numeric' })} · stays a pin on the Future timeline</p>}
        <dl className="grid grid-cols-2 gap-3 pt-2">
          <div><dt className="text-[11px] text-gray-500">Total cost in AUD</dt><dd className="text-2xl font-bold text-white tabular-nums">{fmtAUD(t.spentAudCents)}</dd></div>
          <div><dt className="text-[11px] text-gray-500">Budget</dt><dd className="text-lg text-gray-200 tabular-nums">{fmtAUD(budgetCents)}</dd>
            <dd className={`text-[11px] ${diff > 0 ? 'text-red-300' : 'text-green-300'}`}>{fmtAUD(Math.abs(diff))} {diff > 0 ? 'over' : 'under'}</dd></div>
          {t.spentEurCents > 0 && <div><dt className="text-[11px] text-gray-500">Paid in EUR</dt><dd className="text-gray-200 tabular-nums">{fmtEUR(t.spentEurCents)}</dd></div>}
          <div><dt className="text-[11px] text-gray-500">Items</dt><dd className="text-gray-200 tabular-nums">{t.items}</dd></div>
        </dl>
        {state.openItems > 0 && <p className="text-xs text-amber-300">Archived with {state.openItems} item{state.openItems === 1 ? '' : 's'} not marked paid{t.owedEurCents ? ` (${fmtEUR(t.owedEurCents)} owed)` : ''}.</p>}
      </section>

      <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        <p className="text-xs text-gray-500 uppercase tracking-wider px-4 pt-4 pb-2">Budget vs actual</p>
        <ul className="divide-y divide-gray-800">
          {items.map(i => (
            <li key={i.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className={`block truncate ${i.status === 'cancelled' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{i.item}</span>
                <span className="block text-[11px] text-gray-500">{STATUS[i.status ?? 'pending']}{i.date_paid ? ` · ${fmtDate(i.date_paid)}` : ''}{i.spent_eur_cents ? ` · ${fmtEUR(i.spent_eur_cents)}` : ''}</span>
              </span>
              <span className="text-right tabular-nums">
                <span className="block text-gray-200">{fmtAUD(i.spent_aud_cents ?? 0)}</span>
                <span className="block text-[11px] text-gray-500">of {fmtAUD(i.budget_aud_cents ?? 0)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-1 text-xs text-gray-400">
        <p className="text-gray-500 uppercase tracking-wider">EUR → AUD</p>
        <p>Latest {fx.latest}{fx.latestDate ? ` (${fmtDate(fx.latestDate)})` : ''}{fx.low !== null && fx.high !== null ? ` · range ${fx.low}–${fx.high} since ${fx.from ? fmtDate(fx.from) : 'records began'}` : ''}.</p>
        <p>EUR stays supported everywhere else: the importer converts EUR transactions, Settings › Recurring takes EUR items, and the projection converts any EUR planned item at the stored rate (the &ldquo;EUR still to pay&rdquo; check-in item watches the exposure).</p>
      </section>

      <div className="flex items-center justify-between gap-3 px-1">
        <Link href={'/more' as Route} className="text-xs text-indigo-400">← More</Link>
        {hasEvent && <ArchiveButton archive={false} label="Reopen to edit" />}
      </div>
    </div>
  )
}

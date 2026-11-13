'use client'

import { useState, useTransition } from 'react'
import { Repeat } from 'lucide-react'
import { fmtAUD, fmtDate } from '@/lib/format'
import type { Cadence } from '@/lib/subscriptions/detect'
import { dismissSubscription, restoreSubscription, trackSubscription } from '@/app/(app)/insights/actions'

export type SubRow = {
  key: string; merchant: string; description: string; cadence: Cadence; amountCents: number; monthlyCents: number
  lastSeen: string; nextDue: string | null; isNew: boolean; active: boolean; count: number
  priceChange: { fromCents: number; toCents: number; on: string } | null
  categoryId: string | null; category: string | null
}

const CAD: Record<Cadence, string> = { weekly: 'weekly', fortnightly: 'fortnightly', monthly: 'monthly', quarterly: 'quarterly', annual: 'yearly' }

function Row({ s, mode, canSave }: { s: SubRow; mode: 'untracked' | 'tracked' | 'dismissed' | 'ended'; canSave: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const run = (fn: () => Promise<{ error?: string }>, label: string) => start(async () => {
    setError(null)
    const r = await fn()
    if (r.error) setError(r.error); else setDone(label)
  })

  return (
    <li className="px-4 py-3 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white truncate">
            {s.merchant}
            {s.isNew && mode === 'untracked' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200">new</span>}
            {s.priceChange && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200">{s.priceChange.toCents > s.priceChange.fromCents ? 'up' : 'down'} {fmtAUD(Math.abs(s.priceChange.toCents - s.priceChange.fromCents), { full: true })}</span>}
          </p>
          <p className="text-[11px] text-gray-500 truncate">{s.description}</p>
          <p className="text-[11px] text-gray-500">
            {s.count} charges · last {fmtDate(s.lastSeen, { day: 'numeric', month: 'short' })}{s.nextDue ? ` · next ~${fmtDate(s.nextDue, { day: 'numeric', month: 'short' })}` : ' · looks ended'}{s.category ? ` · ${s.category}` : ''}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm text-white tabular-nums">{fmtAUD(s.amountCents, { full: true })}</p>
          <p className="text-[11px] text-gray-500">{CAD[s.cadence]}{s.cadence !== 'monthly' ? ` · ${fmtAUD(s.monthlyCents)}/mo` : ''}</p>
        </div>
      </div>
      {done ? <p className="text-[11px] text-green-300">{done}</p> : (
        <div className="flex flex-wrap gap-2">
          {mode === 'untracked' && s.nextDue && (
            <button type="button" disabled={pending || !canSave} className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-600 text-white disabled:opacity-50"
              onClick={() => run(() => trackSubscription({ key: s.key, merchant: s.merchant, amountCents: s.amountCents, cadence: s.cadence, nextDue: s.nextDue!, categoryId: s.categoryId }), 'Tracked: now in Settings › Recurring and on the calendar')}>
              Track as planned item
            </button>
          )}
          {(mode === 'untracked' || mode === 'ended') && (
            <button type="button" disabled={pending || !canSave} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 disabled:opacity-50"
              onClick={() => run(() => dismissSubscription(s.key), 'Hidden: not a subscription')}>
              Not a subscription
            </button>
          )}
          {mode === 'tracked' && (
            <button type="button" disabled={pending} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 disabled:opacity-50"
              onClick={() => run(() => restoreSubscription(s.key), 'No longer tracked (its planned item is cancelled)')}>
              Stop tracking
            </button>
          )}
          {mode === 'dismissed' && (
            <button type="button" disabled={pending} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 disabled:opacity-50"
              onClick={() => run(() => restoreSubscription(s.key), 'Restored')}>
              It is a subscription
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </li>
  )
}

function Group({ title, rows, mode, canSave, open = true }: { title: string; rows: SubRow[]; mode: 'untracked' | 'tracked' | 'dismissed' | 'ended'; canSave: boolean; open?: boolean }) {
  if (!rows.length) return null
  const list = <ul className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">{rows.map(s => <Row key={s.key} s={s} mode={mode} canSave={canSave} />)}</ul>
  return open ? (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider px-1"><Repeat size={13} />{title} ({rows.length})</h2>
      {list}
    </section>
  ) : (
    <details className="space-y-2">
      <summary className="text-xs text-gray-500 uppercase tracking-wider px-1 cursor-pointer">{title} ({rows.length})</summary>
      {list}
    </details>
  )
}

export default function SubscriptionList({ untracked, tracked, dismissed, ended, canSave }: { untracked: SubRow[]; tracked: SubRow[]; dismissed: SubRow[]; ended: SubRow[]; canSave: boolean }) {
  return (
    <div className="space-y-4">
      {!untracked.length && !tracked.length && <p className="text-sm text-gray-400 px-1">No recurring charges found yet. They appear after three monthly charges (or two yearly ones).</p>}
      {!canSave && <p className="text-[11px] text-amber-300/80 px-1">Tracking and hiding need migration 0010 to have run.</p>}
      <Group title="Found in your transactions" rows={untracked} mode="untracked" canSave={canSave} />
      <Group title="Tracked as planned items" rows={tracked} mode="tracked" canSave={canSave} />
      <Group title="Looks ended" rows={ended} mode="ended" canSave={canSave} open={false} />
      <Group title="Not subscriptions" rows={dismissed} mode="dismissed" canSave={canSave} open={false} />
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { fmtAUD } from '@/lib/format'
import { PACE_LABEL, type PaceLine } from '@/lib/budgetPace'
import { applySuggestedBudgets } from './actions'

const BAR = { on_track: 'bg-green-500', ahead: 'bg-amber-400', over: 'bg-red-500', no_target: 'bg-gray-600' } as const
const TEXT = { on_track: 'text-green-300', ahead: 'text-amber-300', over: 'text-red-300', no_target: 'text-gray-500' } as const

/** Spend vs light targets with mid-month pace; suggested targets the owner confirms. */
export default function BudgetPaceList({ lines }: { lines: PaceLine[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const withTarget = lines.filter(l => l.targetCents > 0)
  const suggest = lines.filter(l => l.targetCents === 0 && l.suggestedCents && !saved.has(l.id))

  function apply(items: PaceLine[]) {
    setError(null)
    start(async () => {
      const r = await applySuggestedBudgets(items.map(l => ({ categoryId: l.id, monthlyCents: l.suggestedCents! })))
      if (r.error) setError(r.error)
      else setSaved(s => new Set([...s, ...items.map(l => l.id)]))
    })
  }

  return (
    <div className="space-y-3">
      {withTarget.length === 0 && <p className="text-sm text-gray-400">No targets set yet.</p>}
      <ul className="space-y-2.5">
        {withTarget.map(l => {
          const pct = Math.min(100, (l.spentCents / l.targetCents) * 100)
          const marker = Math.min(100, (l.expectedCents / l.targetCents) * 100)
          return (
            <li key={l.id} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-300 truncate">{l.name}</span>
                <span className="tabular-nums text-gray-400">{fmtAUD(l.spentCents)} / {fmtAUD(l.targetCents)} · <span className={TEXT[l.status]}>{PACE_LABEL[l.status]}</span></span>
              </div>
              <div className="relative h-1.5 bg-gray-800 rounded-full" role="progressbar" aria-label={`${l.name} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                <div className={`h-full rounded-full ${BAR[l.status]}`} style={{ width: `${pct}%` }} />
                <div className="absolute top-[-2px] h-2.5 w-px bg-gray-400" style={{ left: `${marker}%` }} aria-hidden="true" title="Even pace for today" />
              </div>
            </li>
          )
        })}
      </ul>
      {withTarget.length > 0 && <p className="text-[11px] text-gray-500">The tick marks an even pace for today. &ldquo;Ahead of pace&rdquo; = spending faster than that.</p>}

      {suggest.length > 0 && (
        <div className="border-t border-gray-800 pt-3 space-y-2">
          <p className="text-xs text-gray-400">Suggested targets from your average of recent complete months. Nothing is saved until you confirm.</p>
          <ul className="space-y-1.5">
            {suggest.map(l => (
              <li key={l.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-300 truncate">{l.name} <span className="text-gray-500">· {fmtAUD(l.spentCents)} so far</span></span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-gray-300">{fmtAUD(l.suggestedCents!)}/mo</span>
                  <button type="button" disabled={pending} onClick={() => apply([l])} className="text-indigo-400 disabled:opacity-50">Use</button>
                </span>
              </li>
            ))}
          </ul>
          {suggest.length > 1 && (
            <button type="button" disabled={pending} onClick={() => apply(suggest)}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">Use all {suggest.length} suggestions</button>
          )}
        </div>
      )}
      {pending && <p className="text-[11px] text-gray-500">Saving…</p>}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

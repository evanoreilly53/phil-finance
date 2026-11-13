'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { Check, Clock, EyeOff, ChevronDown, ChevronUp } from 'lucide-react'
import { fmtAUD, fmtDate } from '@/lib/format'
import { advanceDate } from '@/lib/plannedItems'
import { depositDaysLabel } from '@/lib/insights/labels'
import type { Insight } from '@/lib/insights/types'
import { setInsightState, type InsightAction } from '@/app/(app)/insights/actions'

function snoozeDate(today: string, months: number): string {
  let d = today
  for (let i = 0; i < months; i++) d = advanceDate(d, 'monthly')
  return d
}

/** One check-in card: the fact, its $ and deposit-days effect, the rows behind it, and Done / Snooze / That's intentional. */
export default function InsightCard({ insight, today, canSave }: { insight: Insight; today: string; canSave: boolean }) {
  const [gone, setGone] = useState<string | null>(null)
  const [why, setWhy] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const days = depositDaysLabel(insight.depositDays)

  function act(action: InsightAction, label: string) {
    setError(null)
    start(async () => {
      const r = await setInsightState(insight.key, action)
      if (r.error) setError(r.error)
      else setGone(label)
    })
  }

  if (gone) {
    return (
      <li className="bg-gray-900/60 border border-gray-800 rounded-2xl px-4 py-3 text-xs text-gray-500 flex items-center justify-between gap-3">
        <span>{gone}: &ldquo;{insight.title}&rdquo;</span>
        <button type="button" className="text-indigo-400 flex-shrink-0" onClick={() => start(async () => { const r = await setInsightState(insight.key, { kind: 'clear' }); if (!r.error) setGone(null) })}>Undo</button>
      </li>
    )
  }

  return (
    <li className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-white font-medium leading-snug">{insight.title}</p>
        <span className="text-xs text-indigo-300 tabular-nums whitespace-nowrap">{insight.impactLabel}</span>
      </div>
      {days && <p className="text-xs text-green-300">{days}{insight.depositDays && insight.depositDays > 0 ? ' if acted on (projection)' : ''}</p>}
      {!days && insight.depositNote && <p className="text-[11px] text-gray-500">{insight.depositNote}</p>}
      <p className="text-xs text-gray-400 leading-relaxed">{insight.detail}</p>

      {insight.evidence.length > 0 && (
        <div>
          <button type="button" onClick={() => setWhy(w => !w)} aria-expanded={why} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200">
            {why ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Show the why ({insight.evidence.length})
          </button>
          {why && (
            <ul className="mt-2 space-y-1 text-[11px] border-l border-gray-800 pl-3">
              {insight.evidence.map((e, i) => e.kind === 'tx' ? (
                <li key={e.id + i} className="flex justify-between gap-3 text-gray-400">
                  <span className="truncate">{fmtDate(e.date, { day: 'numeric', month: 'short' })} · {e.description}</span>
                  <span className="tabular-nums text-gray-300 whitespace-nowrap">
                    {fmtAUD(e.cents, { full: true })}{e.currency && e.nativeCents != null ? ` (${e.currency} ${(Math.abs(e.nativeCents) / 100).toFixed(2)})` : ''}
                  </span>
                </li>
              ) : (
                <li key={e.label + i} className="flex justify-between gap-3 text-gray-400"><span>{e.label}</span><span className="text-gray-300 text-right">{e.value}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={pending} onClick={() => act({ kind: 'done' }, 'Done for this month')}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 hover:text-white disabled:opacity-50">
          <Check size={12} /> Done
        </button>
        <label className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-gray-700 text-gray-300">
          <Clock size={12} aria-hidden="true" />
          <span className="sr-only">Snooze</span>
          <select disabled={pending} value="" aria-label="Snooze"
            onChange={e => { const m = Number(e.target.value); if (m) { const until = snoozeDate(today, m); act({ kind: 'snooze', until }, `Snoozed until ${fmtDate(until)}`) } }}
            className="bg-transparent text-[11px] text-gray-300 focus:outline-none">
            <option value="">Snooze</option>
            <option value="1">1 month</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
          </select>
        </label>
        <button type="button" disabled={pending} onClick={() => act({ kind: 'intentional' }, 'Marked intentional')}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 hover:text-white disabled:opacity-50">
          <EyeOff size={12} /> That&apos;s intentional
        </button>
        {insight.href && <Link href={insight.href as Route} className="ml-auto text-[11px] text-indigo-400">{insight.hrefLabel ?? 'Open'} →</Link>}
      </div>
      {!canSave && <p className="text-[11px] text-amber-300/80">Choices can&apos;t be saved until migration 0010 has run.</p>}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </li>
  )
}

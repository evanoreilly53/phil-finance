'use client'

import { useState, useTransition } from 'react'
import { fmtAUD } from '@/lib/format'
import { budgetProgress } from '@/lib/budgets'
import type { CategoryKind } from '@/lib/supabase/database.types'
import { setBudget } from './actions'

export type BudgetLine = { id: string; name: string; colour: string | null; kind: CategoryKind; spentCents: number; targetCents: number }

const BAR = { under: 'bg-green-500', near: 'bg-amber-400', over: 'bg-red-500' } as const

export default function BudgetsView({ monthLabel, lines, uncategorisedCents }: { monthLabel: string; lines: BudgetLine[]; uncategorisedCents: number }) {
  const totalTarget = lines.reduce((s, l) => s + l.targetCents, 0)
  const totalSpent  = lines.filter(l => l.targetCents > 0).reduce((s, l) => s + l.spentCents, 0)

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wider">{monthLabel}</p>
        <p className="text-2xl font-bold text-white tabular-nums mt-1">
          {fmtAUD(totalSpent)} <span className="text-sm font-normal text-gray-500">of {fmtAUD(totalTarget)} budgeted</span>
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          Light targets per category. Transfers between your accounts don&apos;t count. A change applies from this month on.
          {uncategorisedCents > 0 && ` ${fmtAUD(uncategorisedCents)} is still uncategorised.`}
        </p>
      </div>
      <ul className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
        {lines.map(l => <Line key={l.id} line={l} />)}
      </ul>
    </div>
  )
}

function Line({ line }: { line: BudgetLine }) {
  const [value, setValue] = useState(line.targetCents ? String(line.targetCents / 100) : '')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const p = budgetProgress(line.spentCents, line.targetCents)
  const dirty = (value.trim() === '' ? 0 : Math.round(Number(value) * 100)) !== line.targetCents

  function save() {
    const cents = value.trim() === '' ? 0 : Math.round(Number(value) * 100)
    if (!Number.isFinite(cents) || cents < 0) { setError('Enter a positive amount'); return }
    setError(null)
    start(async () => { const r = await setBudget(line.id, cents); if (r.error) setError(r.error) })
  }

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: line.colour ?? '#6b7280' }} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{line.name}</p>
          <p className="text-[11px] text-gray-500">
            {fmtAUD(line.spentCents)} spent{line.targetCents > 0 && ` · ${p.remainingCents >= 0 ? `${fmtAUD(p.remainingCents)} left` : `${fmtAUD(-p.remainingCents)} over`}`}
          </p>
        </div>
        <label className="sr-only" htmlFor={`b-${line.id}`}>Monthly target for {line.name}</label>
        <div className="relative w-24 flex-shrink-0">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs" aria-hidden="true">$</span>
          <input id={`b-${line.id}`} value={value} onChange={e => setValue(e.target.value)} onBlur={() => dirty && save()}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (dirty) save() } }}
            inputMode="decimal" placeholder="none"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-5 pr-2 py-1.5 text-sm text-white text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>
      {line.targetCents > 0 && (
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden" role="progressbar" aria-label={`${line.name} budget used`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(p.pct * 100))}>
          <div className={`h-full ${BAR[p.status]}`} style={{ width: `${Math.min(100, p.pct * 100)}%` }} />
        </div>
      )}
      {pending && <p className="text-[11px] text-gray-500">Saving…</p>}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </li>
  )
}

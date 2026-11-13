// Small shared pieces for the House and Future planning screens.

import Link from 'next/link'
import type { Route } from 'next'
import type { ReactNode } from 'react'

export function Panel({ title, icon, children, aside, id }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4 scroll-mt-20">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider">{icon}{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'good' ? 'text-green-400' : tone === 'warn' ? 'text-amber-300' : tone === 'bad' ? 'text-red-400' : 'text-white'
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-500">{label}</dt>
      <dd className={`font-semibold tabular-nums ${colour}`}>{value}</dd>
      {hint && <dd className="text-[11px] text-gray-500">{hint}</dd>}
    </div>
  )
}

export function Badge({ ok, children }: { ok: boolean | 'na'; children: ReactNode }) {
  const cls = ok === 'na' ? 'bg-gray-800 text-gray-400 border-gray-700' : ok ? 'bg-green-500/10 text-green-300 border-green-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'
  return <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>{children}</span>
}

export function Caveat({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-gray-500 leading-relaxed">{children}</p>
}

type ScenarioChip = { id: string; name: string; is_baseline: boolean }

/** Scenario switcher: chips that set ?s=<id> on `basePath`, keeping other params. */
export function ScenarioChips({ scenarios, currentId, basePath, keep = {}, manageHref }: {
  scenarios: ScenarioChip[]; currentId: string | null; basePath: string; keep?: Record<string, string | undefined>; manageHref?: string
}) {
  const href = (id: string) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v)
    q.set('s', id)
    return `${basePath}?${q.toString()}` as Route
  }
  const ordered = [...scenarios].sort((a, b) => Number(b.is_baseline) - Number(a.is_baseline))
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Scenario">
      {ordered.map(s => {
        const on = s.id === currentId
        return (
          <Link key={s.id} href={href(s.id)} aria-current={on ? 'true' : undefined}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-300 hover:text-white'}`}>
            {s.is_baseline ? 'Baseline' : s.name}
          </Link>
        )
      })}
      {manageHref && <Link href={manageHref as Route} className="text-xs px-3 py-1.5 rounded-full whitespace-nowrap border border-dashed border-gray-700 text-gray-400 hover:text-white">Scenarios…</Link>}
    </div>
  )
}

/** A labelled range slider. Values are plain numbers (callers convert to cents). */
export function Range({ id, label, value, min, max, step, onChange, display, hint }: {
  id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: ReactNode; hint?: ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
        <span className="text-sm text-white font-medium tabular-nums">{display}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-indigo-500" />
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}

export const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'

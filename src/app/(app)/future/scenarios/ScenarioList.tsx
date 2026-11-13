'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { Copy, Archive, Plus, Sparkles, ChevronDown } from 'lucide-react'
import { fmtAUD } from '@/lib/format'
import { PROPERTY_KINDS, type PropertyKind } from '@/lib/house/duty'
import { inputCls } from '@/components/planUi'
import { unitSuffix, type AssumptionUnit } from '@/lib/assumptions'
import {
  archiveScenario, createScenario, duplicateScenario, renameScenario, resetScenarioHouse,
  saveScenarioAssumptions, saveScenarioHouse, saveScenarioLeave, seedExampleScenarios,
} from './actions'

export type ScenarioCard = {
  id: string
  name: string
  description: string
  isBaseline: boolean
  parentName: string | null
  diffs: string[]
  assumptions: { key: string; label: string; unit: AssumptionUnit; value: number; own: boolean }[]
  house: { own: boolean; month: string; priceCents: number; upfrontCents: number; kind: PropertyKind; firstHome: boolean; useScheme: boolean } | null
  leave: { personKey: string; date: string; endDate: string; payPct: number } | null
}

type Person = { key: string; name: string }

function useAction() {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const run = (fn: () => Promise<{ error?: string }>, ok = 'Saved.') => {
    setMsg(null)
    start(async () => { const r = await fn(); setMsg(r.error ?? ok) })
  }
  return { pending, msg, run }
}

export default function ScenarioList({ cards, people }: { cards: ScenarioCard[]; people: Person[] }) {
  const [name, setName] = useState('')
  const top = useAction()
  const onlyBaseline = cards.filter(c => !c.isBaseline).length === 0

  return (
    <div className="space-y-3">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-3">
        <div className="flex gap-2">
          <input aria-label="New scenario name" placeholder="New scenario name" className={`${inputCls} flex-1`} value={name} onChange={e => setName(e.target.value)} />
          <button type="button" disabled={!name.trim() || top.pending} onClick={() => top.run(async () => { const r = await createScenario(name); if (!r.error) setName(''); return r }, 'Created.')}
            className="text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40 flex items-center gap-1"><Plus size={14} /> New</button>
        </div>
        {onlyBaseline && (
          <button type="button" disabled={top.pending} onClick={() => top.run(seedExampleScenarios, 'Examples added: edit or archive them as you like.')}
            className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-200 hover:text-white flex items-center gap-1.5">
            <Sparkles size={14} /> Add example scenarios ($850k with the 5% scheme, one income for 12 months, rates +1%)
          </button>
        )}
        {top.msg && <p className="text-xs text-gray-400" role="status">{top.msg}</p>}
      </div>
      {cards.map(c => <Card key={c.id} c={c} people={people} />)}
    </div>
  )
}

function Card({ c, people }: { c: ScenarioCard; people: Person[] }) {
  const [open, setOpen] = useState(false)
  const act = useAction()
  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white font-medium">{c.isBaseline ? `Baseline: ${c.name}` : c.name}</p>
          {c.description && <p className="text-xs text-gray-400">{c.description}</p>}
          {!c.isBaseline && <p className="text-[11px] text-gray-500">Fork of {c.parentName ?? 'the baseline'}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Link href={`/future?s=${c.id}` as Route} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:text-white">View</Link>
          <button type="button" title="Duplicate" aria-label={`Duplicate ${c.name}`} disabled={act.pending} onClick={() => act.run(() => duplicateScenario(c.id), 'Duplicated.')} className="p-1.5 rounded-lg border border-gray-700 text-gray-300 hover:text-white"><Copy size={14} /></button>
          {!c.isBaseline && (
            <button type="button" title="Archive" aria-label={`Archive ${c.name}`} disabled={act.pending}
              onClick={() => { if (confirm(`Archive “${c.name}”? It disappears from the lists; its data is kept.`)) act.run(() => archiveScenario(c.id), 'Archived.') }}
              className="p-1.5 rounded-lg border border-gray-700 text-gray-300 hover:text-white"><Archive size={14} /></button>
          )}
        </div>
      </div>
      {c.diffs.length > 0 && <ul className="text-xs text-gray-300 list-disc pl-4">{c.diffs.map(d => <li key={d}>{d}</li>)}</ul>}
      {act.msg && <p className="text-xs text-gray-400" role="status">{act.msg}</p>}
      {!c.isBaseline && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="text-xs text-indigo-400 flex items-center gap-1">
          <ChevronDown size={13} className={open ? 'rotate-180' : ''} /> {open ? 'Close' : 'Edit'}
        </button>
      )}
      {c.isBaseline && <p className="text-[11px] text-gray-500">The baseline is your real plan: edit it in <Link href={'/more/assumptions' as Route} className="text-indigo-400">More › Assumptions</Link> and on the House tab.</p>}
      {open && <Editor c={c} people={people} />}
    </section>
  )
}

const dollars = (c: number) => String(Math.round(c / 100))

function Editor({ c, people }: { c: ScenarioCard; people: Person[] }) {
  const [nm, setNm] = useState(c.name)
  const [desc, setDesc] = useState(c.description)
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(c.assumptions.map(a => [a.key, a.own ? String(a.value) : ''])))
  const [h, setH] = useState(() => c.house ? { month: c.house.month, price: dollars(c.house.priceCents), upfront: dollars(c.house.upfrontCents), kind: c.house.kind, firstHome: c.house.firstHome, useScheme: c.house.useScheme } : null)
  const [lv, setLv] = useState(() => ({
    on: !!c.leave,
    personKey: c.leave?.personKey ?? people[people.length - 1]?.key ?? '',
    start: c.leave?.date.slice(0, 7) ?? c.house?.month ?? '',
    months: c.leave ? String(monthsBetween(c.leave.date, c.leave.endDate)) : '12',
    pay: c.leave ? String(c.leave.payPct) : '0',
  }))
  const a1 = useAction(), a2 = useAction(), a3 = useAction(), a4 = useAction()

  return (
    <div className="space-y-5 border-t border-gray-800 pt-3">
      <fieldset className="space-y-2">
        <legend className="text-xs text-gray-400 mb-1">Name</legend>
        <input aria-label="Scenario name" className={inputCls} value={nm} onChange={e => setNm(e.target.value)} />
        <input aria-label="Description" placeholder="What this scenario is about" className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} />
        <Save a={a1} onClick={() => a1.run(() => renameScenario(c.id, nm, desc))} />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs text-gray-400 mb-1">Assumptions (blank = same as the baseline)</legend>
        <div className="grid grid-cols-2 gap-2">
          {c.assumptions.map(a => (
            <label key={a.key} className="text-[11px] text-gray-400 space-y-1">
              <span>{a.label}{unitSuffix(a.unit)}</span>
              <input inputMode="decimal" className={inputCls} placeholder={String(a.value)} value={vals[a.key] ?? ''} onChange={e => setVals(v => ({ ...v, [a.key]: e.target.value }))} />
            </label>
          ))}
        </div>
        <Save a={a2} onClick={() => a2.run(() => saveScenarioAssumptions(c.id, vals))} />
      </fieldset>

      {h && (
        <fieldset className="space-y-2">
          <legend className="text-xs text-gray-400 mb-1">House plan {c.house?.own ? '(this scenario’s own)' : '(same as the baseline until you save)'}</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-gray-400 space-y-1"><span>Buy in</span><input type="month" className={inputCls} value={h.month} onChange={e => setH({ ...h, month: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400 space-y-1"><span>Price ($)</span><input inputMode="decimal" className={inputCls} value={h.price} onChange={e => setH({ ...h, price: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400 space-y-1"><span>Upfront cash ($)</span><input inputMode="decimal" className={inputCls} value={h.upfront} onChange={e => setH({ ...h, upfront: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400 space-y-1"><span>Property</span>
              <select className={inputCls} value={h.kind} onChange={e => setH({ ...h, kind: e.target.value as PropertyKind })}>{PROPERTY_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-200">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={h.firstHome} onChange={e => setH({ ...h, firstHome: e.target.checked })} /> First home</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={h.useScheme} onChange={e => setH({ ...h, useScheme: e.target.checked })} /> 5% scheme if eligible</label>
          </div>
          <div className="flex items-center gap-2">
            <Save a={a3} onClick={() => {
              const price = Math.round(Number(h.price) * 100), upfront = Math.round(Number(h.upfront) * 100)
              if (!Number.isFinite(price) || !Number.isFinite(upfront)) return
              a3.run(() => saveScenarioHouse(c.id, { month: h.month, priceCents: price, upfrontCents: upfront, propertyKind: h.kind, firstHome: h.firstHome, useScheme: h.useScheme }))
            }} />
            {c.house?.own && <button type="button" className="text-xs text-gray-400 underline" onClick={() => a3.run(() => resetScenarioHouse(c.id), 'Back to the baseline house.')}>Use the baseline house</button>}
          </div>
          <p className="text-[11px] text-gray-500">Duty, fees, LMI and FHOG are recalculated for the price and month. Upfront cash {fmtAUD(Math.round(Number(h.upfront) * 100) || 0)} includes them.</p>
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs text-gray-400 mb-1">Time off work</legend>
        <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" className="accent-indigo-500" checked={lv.on} onChange={e => setLv({ ...lv, on: e.target.checked })} /> One of us on reduced or no pay for a while</label>
        {lv.on && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-gray-400 space-y-1"><span>Who</span>
              <select className={inputCls} value={lv.personKey} onChange={e => setLv({ ...lv, personKey: e.target.value })}>{people.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
            </label>
            <label className="text-[11px] text-gray-400 space-y-1"><span>From</span><input type="month" className={inputCls} value={lv.start} onChange={e => setLv({ ...lv, start: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400 space-y-1"><span>Months</span><input inputMode="numeric" className={inputCls} value={lv.months} onChange={e => setLv({ ...lv, months: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400 space-y-1"><span>% of pay received</span><input inputMode="decimal" className={inputCls} value={lv.pay} onChange={e => setLv({ ...lv, pay: e.target.value })} /></label>
          </div>
        )}
        <Save a={a4} onClick={() => a4.run(() => saveScenarioLeave(c.id, lv.on ? { personKey: lv.personKey, startMonth: lv.start, months: Number(lv.months), payPct: Number(lv.pay) } : null))} />
        <p className="text-[11px] text-gray-500">Tax is worked out as if the reduced pay applied all year (an approximation). Government parental leave pay isn&apos;t added automatically: set the % to include it.</p>
      </fieldset>
    </div>
  )
}

function Save({ a, onClick }: { a: ReturnType<typeof useAction>; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={a.pending} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{a.pending ? 'Saving…' : 'Save'}</button>
      {a.msg && <span className="text-xs text-gray-400" role="status">{a.msg}</span>}
    </div>
  )
}

function monthsBetween(start: string, end: string): number {
  const [y1, m1] = start.slice(0, 7).split('-').map(Number)
  const [y2, m2] = end.slice(0, 7).split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) + 1
}

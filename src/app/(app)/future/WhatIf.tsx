'use client'

import { useDeferredValue, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import { fmtAUD, fmtCompact, monthLabel } from '@/lib/format'
import { purchase } from '@/lib/house/purchase'
import { summariseScenario, type ScenarioSummary } from '@/lib/projection/scenarios'
import { addMonthsKey } from '@/lib/projection/schedule'
import type { AssumptionKey } from '@/lib/assumptions'
import type { HouseParams, ProjectionInput } from '@/lib/projection/types'
import { Caveat, Range, inputCls } from '@/components/planUi'
import { saveWhatIfAsScenario, type HousePatch } from './scenarios/actions'

type Props = {
  input: ProjectionInput
  house: { date: string; params: HouseParams } | null
  scenarioId: string | null
  scenarioName: string
  atMonth: string
}

const sc = (c: number) => `${c < 0 ? '−' : ''}${fmtCompact(c)}`
const mon = (mk: string | null | 'now') => (mk === 'now' ? 'now' : mk ? monthLabel(mk, { month: 'short', year: 'numeric' }) : 'not reached')

type Levers = { price: number; shift: number; extra: number; wages: number; mortgage: number; cash: number }

/** Sensitivity sliders: change a lever, see the dates and totals move. Nothing is saved until "Save as scenario". */
export default function WhatIf({ input, house, scenarioId, scenarioName, atMonth }: Props) {
  const a = input.assumptions
  const start: Levers = {
    price: house ? Math.round(house.params.priceCents / 100) : 0,
    shift: 0,
    extra: Math.round((input.extraMonthlyCents ?? 0) / 100),
    wages: a.wage_growth_pct,
    mortgage: a.mortgage_rate_pct,
    cash: a.cash_return_pct,
  }
  const [lv, setLv] = useState<Levers>(start)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startT] = useTransition()
  const router = useRouter()
  const set = (k: keyof Levers) => (v: number) => setLv(x => ({ ...x, [k]: v }))
  const d = useDeferredValue(lv)

  const base = useMemo(() => summariseScenario(input, house, atMonth), [input, house, atMonth])
  const { what, newHouse } = useMemo(() => {
    const moved = input.events.map(e => {
      if (!house || e.kind !== 'house_purchase' || !e.house || e.status !== 'planned') return { e, h: null }
      const date = `${addMonthsKey(house.date.slice(0, 7), d.shift)}-01`
      const priceCents = d.price * 100
      const costs = e.house.costsSource === 'entered' && priceCents === house.params.priceCents ? e.house.costsCents : purchase({
        priceCents, cashCents: e.house.upfrontCents, firstHome: e.house.firstHome, kind: e.house.propertyKind, contractDate: date, useScheme: e.house.useScheme,
      }).costsCents
      const params: HouseParams = { ...e.house, priceCents, costsCents: costs, costsSource: 'calculated' }
      return { e: { ...e, date, house: params }, h: { date, params } }
    })
    const events = moved.map(x => x.e)
    const h = moved.find(x => x.h)?.h ?? house
    const mod: ProjectionInput = {
      ...input, events, extraMonthlyCents: d.extra * 100,
      assumptions: { ...a, wage_growth_pct: d.wages, mortgage_rate_pct: d.mortgage, cash_return_pct: d.cash },
    }
    return { what: summariseScenario(mod, h, atMonth), newHouse: h }
  }, [input, house, atMonth, a, d])

  const changedAssumptions: Partial<Record<AssumptionKey, number>> = {}
  if (lv.extra !== start.extra) changedAssumptions.extra_saving_monthly = lv.extra
  if (lv.wages !== start.wages) changedAssumptions.wage_growth_pct = lv.wages
  if (lv.mortgage !== start.mortgage) changedAssumptions.mortgage_rate_pct = lv.mortgage
  if (lv.cash !== start.cash) changedAssumptions.cash_return_pct = lv.cash
  const housePatch: HousePatch = {}
  if (house && lv.price !== start.price) housePatch.priceCents = lv.price * 100
  if (house && lv.shift !== 0) housePatch.month = addMonthsKey(house.date.slice(0, 7), lv.shift)
  const dirty = Object.keys(changedAssumptions).length > 0 || Object.keys(housePatch).length > 0

  function save() {
    setMsg(null)
    startT(async () => {
      const res = await saveWhatIfAsScenario({ name: name || 'What-if', parentId: scenarioId, assumptions: changedAssumptions, house: Object.keys(housePatch).length ? housePatch : null })
      if (res.error) { setMsg(res.error); return }
      setMsg('Saved.')
      if (res.id) router.push(`/future?s=${res.id}` as Route)
    })
  }

  return (
    <details className="bg-gray-900 rounded-2xl border border-gray-800 p-5 group" open={dirty || undefined}>
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <span className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider"><SlidersHorizontal size={14} /> What if…</span>
        <span className="text-xs text-indigo-400 group-open:hidden">Open sliders</span>
      </summary>
      <div className="space-y-4 mt-4">
        <p className="text-xs text-gray-400">Starting from {scenarioName}. Nothing is saved until you save it as a scenario.</p>
        {house && <Range id="w-price" label="House price" value={lv.price} min={500_000} max={1_300_000} step={10_000} onChange={set('price')} display={fmtAUD(lv.price * 100)} hint="Same upfront cash; WA duty, fees, LMI and FHOG recalculated" />}
        {house && <Range id="w-shift" label="Buy" value={lv.shift} min={-18} max={24} step={1} onChange={set('shift')} display={`${mon(newHouse?.date.slice(0, 7) ?? null)}${lv.shift ? ` (${lv.shift > 0 ? '+' : ''}${lv.shift} mo)` : ''}`} />}
        <Range id="w-extra" label="Extra saving a month" value={lv.extra} min={-2_000} max={4_000} step={50} onChange={set('extra')} display={fmtAUD(lv.extra * 100, { signed: lv.extra !== 0 })} hint="Spend less (+) or more (−) than your recent average" />
        <Range id="w-wages" label="Salary growth" value={lv.wages} min={0} max={8} step={0.25} onChange={set('wages')} display={`${lv.wages}% a year`} />
        <Range id="w-mort" label="Mortgage rate" value={lv.mortgage} min={3} max={10} step={0.25} onChange={set('mortgage')} display={`${lv.mortgage}%`} />
        <Range id="w-cash" label="Savings interest" value={lv.cash} min={0} max={7} step={0.25} onChange={set('cash')} display={`${lv.cash}%`} />

        <Compare base={base} what={what} />

        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Scenario name" placeholder="Name this scenario" className={`${inputCls} flex-1 min-w-40`} value={name} onChange={e => setName(e.target.value)} />
          <button type="button" onClick={save} disabled={!dirty || pending} className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{pending ? 'Saving…' : 'Save as scenario'}</button>
          <button type="button" onClick={() => setLv(start)} disabled={!dirty} className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 disabled:opacity-40 flex items-center gap-1"><RotateCcw size={13} /> Reset</button>
        </div>
        {msg && <p className="text-xs text-gray-400" role="status">{msg}</p>}
        <Caveat>Deterministic: one path, no luck either way. Dates to the month.</Caveat>
      </div>
    </details>
  )
}

function Compare({ base, what }: { base: ScenarioSummary; what: ScenarioSummary }) {
  const rows: { label: string; a: string; b: string; better?: boolean | null }[] = [
    { label: 'Deposit ready', a: mon(base.depositReadyMonth), b: mon(what.depositReadyMonth) },
    { label: 'Loan', a: base.loanCents !== null ? fmtCompact(base.loanCents) : '—', b: what.loanCents !== null ? fmtCompact(what.loanCents) : '—' },
    { label: 'Repayment', a: base.monthlyRepaymentCents ? `${fmtAUD(base.monthlyRepaymentCents)}/mo` : '—', b: what.monthlyRepaymentCents ? `${fmtAUD(what.monthlyRepaymentCents)}/mo` : '—' },
    { label: `Net worth ${mon(base.atMonth)}`, a: base.netWorthAtCents !== null ? fmtCompact(base.netWorthAtCents) : '—', b: what.netWorthAtCents !== null ? fmtCompact(what.netWorthAtCents) : '—', better: what.netWorthAtCents !== null && base.netWorthAtCents !== null ? what.netWorthAtCents >= base.netWorthAtCents : null },
    { label: 'Lowest cash', a: base.lowestCash ? `${sc(base.lowestCash.cents)} (${mon(base.lowestCash.month)})` : '—', b: what.lowestCash ? `${sc(what.lowestCash.cents)} (${mon(what.lowestCash.month)})` : '—', better: what.lowestCash && base.lowestCash ? what.lowestCash.cents >= base.lowestCash.cents : null },
  ]
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-[11px] text-gray-500"><th className="text-left font-normal py-1"></th><th className="text-right font-normal">Now</th><th className="text-right font-normal">What if</th></tr></thead>
      <tbody className="divide-y divide-gray-800">
        {rows.map(r => (
          <tr key={r.label}>
            <td className="py-1.5 text-gray-400">{r.label}</td>
            <td className="py-1.5 text-right tabular-nums text-gray-300">{r.a}</td>
            <td className={`py-1.5 text-right tabular-nums ${r.a === r.b ? 'text-gray-300' : r.better === false ? 'text-amber-300' : 'text-white font-medium'}`}>{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

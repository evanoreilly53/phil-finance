'use client'

import { useDeferredValue, useMemo, useState, useTransition } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts'
import { Calculator } from 'lucide-react'
import { fmtAUD, fmtCompact, monthLabel } from '@/lib/format'
import { dutyCurve, PROPERTY_KINDS, type PropertyKind } from '@/lib/house/duty'
import { purchase } from '@/lib/house/purchase'
import { DEPOSIT_SCHEME, ruleFor, WA_DUTY, WA_FHOG } from '@/lib/house/rules'
import { Badge, Caveat, Panel, Range, Stat, inputCls } from '@/components/planUi'
import { saveScenarioHouse } from '../future/scenarios/actions'

type Props = {
  scenarioId: string | null
  scenarioLabel: string
  month: string
  priceCents: number
  cashCents: number
  firstHome: boolean
  kind: PropertyKind
  useScheme: boolean
  /** What the deposit accounts are projected to hold by the house month (no purchase). */
  projectedPotCents: number | null
}

const PRICE_MIN = 500_000
const PRICE_MAX = 1_200_000
const k = (cents: number) => fmtAUD(cents)

export default function PriceExplorer(p: Props) {
  const [price, setPrice] = useState(Math.round(p.priceCents / 100))
  const [cash, setCash] = useState(Math.round(p.cashCents / 100))
  const [kind, setKind] = useState<PropertyKind>(p.kind)
  const [firstHome, setFirstHome] = useState(p.firstHome)
  const [useScheme, setUseScheme] = useState(p.useScheme)
  const [month, setMonth] = useState(p.month)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const dPrice = useDeferredValue(price)
  const dCash = useDeferredValue(cash)
  const contractDate = `${month}-01`
  const r = useMemo(() => purchase({ priceCents: dPrice * 100, cashCents: dCash * 100, firstHome, kind, contractDate, useScheme }),
    [dPrice, dCash, firstHome, kind, contractDate, useScheme])
  const curve = useMemo(() => dutyCurve({ firstHome, kind, contractDate }, PRICE_MIN * 100, PRICE_MAX * 100, 1_000_000)
    .map(x => ({ price: x.priceCents / 100, duty: Math.round(x.dutyCents / 100), general: Math.round(x.generalCents / 100) })), [firstHome, kind, contractDate])

  const rules = ruleFor(WA_DUTY, contractDate)
  const scale = kind === 'vacant_land' ? rules.fhorLand : rules.fhorHome
  const schemeCap = ruleFor(DEPOSIT_SCHEME, contractDate).capPerthCents / 100
  const fhogCap = ruleFor(WA_FHOG, contractDate).capSouthCents / 100
  const changed = price * 100 !== p.priceCents || cash * 100 !== p.cashCents || kind !== p.kind || firstHome !== p.firstHome || useScheme !== p.useScheme || month !== p.month

  // Plain-English callouts about where the steps are.
  const callouts: string[] = []
  if (firstHome) {
    const perTenK = Math.round(scale.per100 * 100)
    callouts.push(`Up to ${fmtCompact(scale.nilToCents)}: no duty for a first home${kind === 'vacant_land' ? ' (land)' : ''}.`)
    callouts.push(`${fmtCompact(scale.nilToCents)}–${fmtCompact(scale.capCents)}: every extra $10,000 of price adds ${fmtAUD(perTenK * 100)} of duty (${scale.per100} per $100).`)
    const atCap = Math.round(((scale.capCents - scale.nilToCents) / 10_000) * scale.per100 * 100)
    callouts.push(`Above ${fmtCompact(scale.capCents)} the first-home rate stops and the general rate applies to the whole price (${fmtAUD(atCap)} at the cap).`)
  } else {
    callouts.push('Not a first home: general rate at every price.')
  }
  callouts.push(`5% Deposit Scheme: Perth price cap ${fmtCompact(schemeCap * 100)}. Above it, a deposit under 20% means LMI.`)
  if (kind !== 'established') callouts.push(`First Home Owner Grant ($10,000): new homes up to ${fmtCompact(fhogCap * 100)}.`)

  function save() {
    setMsg(null)
    start(async () => {
      const res = await saveScenarioHouse(p.scenarioId, { priceCents: price * 100, upfrontCents: cash * 100, propertyKind: kind, firstHome, useScheme, month })
      setMsg(res.error ?? `Saved to ${p.scenarioLabel}.`)
    })
  }

  return (
    <Panel title="Price explorer" icon={<Calculator size={14} />} id="price">
      <div className="space-y-4">
        <Range id="px-price" label="Price" value={price} min={PRICE_MIN} max={PRICE_MAX} step={5_000} onChange={setPrice} display={k(price * 100)} />
        <Range id="px-cash" label="Cash at settlement (deposit + costs)" value={cash} min={20_000} max={400_000} step={5_000} onChange={setCash} display={k(cash * 100)}
          hint={p.projectedPotCents !== null ? `Your deposit accounts are projected to hold ${fmtCompact(p.projectedPotCents)} by ${monthLabel(month, { month: 'short', year: 'numeric' })}.` : undefined} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="px-kind" className="text-xs text-gray-400">Property</label>
            <select id="px-kind" className={inputCls} value={kind} onChange={e => setKind(e.target.value as PropertyKind)}>
              {PROPERTY_KINDS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="px-month" className="text-xs text-gray-400">Contract month</label>
            <input id="px-month" type="month" className={inputCls} value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-200">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={firstHome} onChange={e => setFirstHome(e.target.checked)} /> First home buyers</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={useScheme} onChange={e => setUseScheme(e.target.checked)} /> Use the 5% scheme if eligible</label>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 border-t border-gray-800 pt-4">
        <Stat label="Loan" value={fmtCompact(r.loanCents)} />
        <Stat label="LVR" value={`${r.lvrPct.toFixed(1)}%`} tone={r.lvrPct > 95 ? 'bad' : r.lvrPct > 80 && !r.schemeApplied ? 'warn' : undefined} />
        <Stat label="Lost to costs" value={fmtCompact(r.costsCents)} hint="duty, fees, LMI − grant" />
      </dl>

      <div className="flex flex-wrap gap-1.5">
        <Badge ok={r.duty.basis === 'exempt' || r.duty.basis === 'first_home_rate' || r.duty.basis === 'off_the_plan'}>{r.duty.basis === 'general' ? 'General duty rate' : r.duty.basis === 'exempt' ? 'No duty' : r.duty.basis === 'off_the_plan' ? 'Off-the-plan concession' : 'First-home duty rate'}</Badge>
        <Badge ok={r.scheme.eligible}>{r.scheme.eligible ? (r.schemeApplied ? '5% scheme: used, no LMI' : '5% scheme: eligible') : '5% scheme: not eligible'}</Badge>
        <Badge ok={r.fhog.eligible}>{r.fhog.eligible ? 'FHOG $10,000' : 'No FHOG'}</Badge>
        {r.lmi.totalCents > 0 && <Badge ok={false}>LMI ≈ {fmtCompact(r.lmi.totalCents)}</Badge>}
      </div>
      {(!r.scheme.eligible && r.scheme.reasons.length > 0) && <p className="text-[11px] text-gray-500">5% scheme: {r.scheme.reasons.join('; ')}.</p>}
      {(!r.fhog.eligible && kind !== 'established') && <p className="text-[11px] text-gray-500">FHOG: {r.fhog.reasons.join('; ')}.</p>}

      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-800">
          {r.lines.map(l => (
            <tr key={l.key}>
              <td className="py-1.5 text-gray-300">{l.label}{l.estimate && <span className="text-[10px] text-gray-500"> · estimate</span>}{l.note && <span className="block text-[11px] text-gray-500">{l.note}</span>}</td>
              <td className={`py-1.5 text-right tabular-nums ${l.cents < 0 ? 'text-green-400' : 'text-white'}`}>{fmtAUD(l.cents, { signed: l.cents < 0 })}</td>
            </tr>
          ))}
          <tr><td className="py-1.5 text-gray-400">Total cash</td><td className="py-1.5 text-right tabular-nums text-white font-semibold">{fmtAUD(r.depositCents + r.costsCents)}</td></tr>
        </tbody>
      </table>
      {r.problems.map(x => <p key={x} className="text-xs text-amber-300">{x}</p>)}

      <div>
        <p className="text-xs text-gray-400 mb-1">Transfer duty by price{firstHome ? ' (first home)' : ''}</p>
        <p className="sr-only">Duty at {k(price * 100)}: {fmtAUD(r.duty.payableCents)}. {callouts.join(' ')}</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#1f2937" vertical={false} />
            <XAxis dataKey="price" type="number" domain={[PRICE_MIN, PRICE_MAX]} tickFormatter={v => `$${Math.round(v / 1000)}k`} tick={{ fill: '#6b7280', fontSize: 10 }} ticks={[500_000, 600_000, 700_000, 800_000, 900_000, 1_000_000, 1_100_000, 1_200_000]} />
            <YAxis tickFormatter={v => `$${Math.round(v / 1000)}k`} tick={{ fill: '#6b7280', fontSize: 10 }} width={44} />
            <Tooltip formatter={(v) => `$${Number(v).toLocaleString('en-AU')}`} labelFormatter={v => `Price $${Number(v).toLocaleString('en-AU')}`} contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }} />
            {firstHome && <Line type="linear" dataKey="general" name="General rate" stroke="#4b5563" strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
            <Line type="linear" dataKey="duty" name="You'd pay" stroke="#f9a8d4" strokeWidth={2} dot={false} isAnimationActive={false} />
            {firstHome && <ReferenceLine x={scale.nilToCents / 100} stroke="#34d399" strokeDasharray="2 2" label={{ value: 'duty starts', fill: '#34d399', fontSize: 9, position: 'insideTopLeft' }} />}
            {firstHome && <ReferenceLine x={scale.capCents / 100} stroke="#fbbf24" strokeDasharray="2 2" label={{ value: 'FH cap', fill: '#fbbf24', fontSize: 9, position: 'insideTopLeft' }} />}
            <ReferenceLine x={schemeCap} stroke="#60a5fa" strokeDasharray="2 2" label={{ value: '5% cap', fill: '#60a5fa', fontSize: 9, position: 'insideBottomRight' }} />
            <ReferenceLine x={price} stroke="#e5e7eb" />
          </LineChart>
        </ResponsiveContainer>
        <ul className="mt-2 space-y-1 text-xs text-gray-300 list-disc pl-4">
          {callouts.map(c => <li key={c}>{c}</li>)}
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!changed || pending}
          className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{pending ? 'Saving…' : `Use in ${p.scenarioLabel}`}</button>
        {msg && <span className="text-xs text-gray-400" role="status">{msg}</span>}
      </div>
      <Caveat>Duty from RevenueWA&apos;s published rates for agreements on this date; FHOG and the 5% scheme are eligibility checks on price and property type only (citizenship, age, residence and lender rules also apply). LMI is an indicative estimate, not a quote. Not advice.</Caveat>
    </Panel>
  )
}

'use client'

import { useDeferredValue, useMemo, useState, useTransition } from 'react'
import { Landmark } from 'lucide-react'
import { fmtAUD, fmtCompact } from '@/lib/format'
import { compareMortgage, rateShock } from '@/lib/house/mortgage'
import { Caveat, Panel, Range, Stat, inputCls } from '@/components/planUi'
import { saveScenarioHouse } from '../future/scenarios/actions'

type Props = {
  scenarioId: string | null
  scenarioLabel: string
  loanCents: number
  ratePct: number
  termMonths: number
  cashAccounts: { id: string; name: string; balanceCents: number }[]
  offsetAccountId: string | null
  extraRepaymentMonthlyCents: number
  /** Monthly cash surplus after the purchase in the projection (for the "park savings" default). */
  surplusAfterCents: number
}

const yrs = (months: number) => `${Math.floor(months / 12)} yrs${months % 12 ? ` ${months % 12} mo` : ''}`

export default function MortgageCard(p: Props) {
  const startOffset = p.cashAccounts.find(a => a.id === p.offsetAccountId)?.balanceCents ?? 0
  const [rate, setRate] = useState(p.ratePct)
  const [offset, setOffset] = useState(Math.round(Math.max(0, startOffset) / 100))
  const [add, setAdd] = useState(Math.max(0, Math.round(p.surplusAfterCents / 100 / 100) * 100))
  const [extra, setExtra] = useState(Math.round(p.extraRepaymentMonthlyCents / 100))
  const [account, setAccount] = useState(p.offsetAccountId ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const d = useDeferredValue({ rate, offset, add, extra })
  const c = useMemo(() => compareMortgage({
    loanCents: p.loanCents, ratePct: d.rate, termMonths: p.termMonths, offsetCents: d.offset * 100, offsetMonthlyAddCents: d.add * 100, extraMonthlyCents: d.extra * 100,
  }), [p.loanCents, p.termMonths, d])
  const shock = useMemo(() => rateShock(p.loanCents, rate, p.termMonths), [p.loanCents, rate, p.termMonths])
  const dailyPerThousand = (rate / 100 / 365) * 1000

  function save() {
    setMsg(null)
    start(async () => {
      const res = await saveScenarioHouse(p.scenarioId, { offsetAccountId: account || null, extraRepaymentMonthlyCents: extra * 100 })
      setMsg(res.error ?? `Saved to ${p.scenarioLabel}.`)
    })
  }

  if (p.loanCents <= 0) {
    return <Panel title="Mortgage & offset" icon={<Landmark size={14} />} id="mortgage"><p className="text-sm text-gray-400">No mortgage in this plan.</p></Panel>
  }

  return (
    <Panel title="Mortgage & offset" icon={<Landmark size={14} />} id="mortgage">
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Loan" value={fmtCompact(p.loanCents)} />
        <Stat label="Repayment" value={`${fmtAUD(c.base.repaymentCents)}/mo`} hint={`P&I, ${Math.round(p.termMonths / 12)} yrs at ${rate}%`} />
        <Stat label="Total interest" value={fmtCompact(c.base.totalInterestCents)} hint="no offset or extras" />
      </dl>

      <div className="space-y-4">
        <Range id="m-rate" label="Interest rate" value={rate} min={2} max={10} step={0.05} onChange={setRate} display={`${rate.toFixed(2)}%`} />
        <Range id="m-offset" label="Offset balance at settlement" value={offset} min={0} max={300_000} step={5_000} onChange={setOffset} display={fmtAUD(offset * 100)} />
        <Range id="m-add" label="Added to the offset each month" value={add} min={0} max={8_000} step={100} onChange={setAdd} display={`${fmtAUD(add * 100)}/mo`}
          hint={p.surplusAfterCents > 0 ? `The projection has about ${fmtAUD(p.surplusAfterCents)}/mo left over after the purchase.` : undefined} />
        <Range id="m-extra" label="Extra repayments" value={extra} min={0} max={3_000} step={50} onChange={setExtra} display={`${fmtAUD(extra * 100)}/mo`} />
      </div>

      <dl className="grid grid-cols-3 gap-3 border-t border-gray-800 pt-4">
        <Stat label="Interest saved" value={fmtCompact(c.interestSavedCents)} tone={c.interestSavedCents > 0 ? 'good' : undefined} />
        <Stat label="Paid off" value={yrs(c.withExtras.months)} hint={c.monthsSaved > 0 ? `${yrs(c.monthsSaved)} sooner` : undefined} />
        <Stat label="You pay" value={`${fmtAUD(c.withExtras.paymentCents)}/mo`} />
      </dl>
      <p className="text-xs text-gray-300">
        Money in an offset isn&apos;t earning interest: it stops interest being charged. Every $1,000 there saves about ${dailyPerThousand.toFixed(2)} a day at {rate}%,
        and that saving isn&apos;t taxed the way savings interest is.
      </p>

      <div>
        <p className="text-xs text-gray-400 mb-1">If rates rise (same loan and term)</p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-800">
            {shock.map((s, i) => (
              <tr key={s.ratePct}>
                <td className="py-1 text-gray-300">{s.ratePct}%{i === 0 ? ' (plan)' : ` (+${i})`}</td>
                <td className="py-1 text-right tabular-nums text-white">{fmtAUD(s.repaymentCents)}/mo</td>
                <td className="py-1 text-right tabular-nums text-gray-400 w-24">{i ? `+${fmtAUD(s.repaymentCents - shock[0].repaymentCents)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-800 pt-4 space-y-2">
        <p className="text-xs text-gray-400">Feed the projection after the purchase</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="m-acc" className="text-xs text-gray-400">Offset account</label>
            <select id="m-acc" className={inputCls} value={account} onChange={e => setAccount(e.target.value)}>
              <option value="">No offset</option>
              {p.cashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" onClick={save} disabled={pending || (account === (p.offsetAccountId ?? '') && extra * 100 === p.extraRepaymentMonthlyCents)}
              className="w-full text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{pending ? 'Saving…' : `Use in ${p.scenarioLabel}`}</button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500">From the month after settlement, the chosen account offsets the mortgage (it stops earning savings interest), and the extra repayment of {fmtAUD(extra * 100)}/mo is added.</p>
        {msg && <p className="text-xs text-gray-400" role="status">{msg}</p>}
      </div>
      <Caveat>Principal and interest, monthly, with the repayment fixed at settlement. Real loans differ (fees, rate changes, fixed periods, redraw). Not advice.</Caveat>
    </Panel>
  )
}

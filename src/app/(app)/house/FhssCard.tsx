'use client'

import { useMemo, useState } from 'react'
import { PiggyBank, CalendarClock } from 'lucide-react'
import { fmtAUD, monthLabel } from '@/lib/format'
import { fhssVsCash, type FhssPerson } from '@/lib/house/fhss'
import { FHSS } from '@/lib/house/rules'
import { Caveat, Panel, Range, Stat } from '@/components/planUi'

type Props = {
  people: (FhssPerson & { key: string })[]
  startMonth: string
  releaseMonth: string
  signMonth: string
  fys: string[]
  cashRatePct: number
}

const mon = (mk: string) => monthLabel(mk, { month: 'short', year: 'numeric' })

export default function FhssCard(p: Props) {
  const [amounts, setAmounts] = useState<Record<string, number>>(() => Object.fromEntries(p.people.map(x => [x.key, 15_000])))
  const results = useMemo(() => p.people.map(person => ({
    person,
    r: fhssVsCash({ person, startMonth: p.startMonth, releaseMonth: p.releaseMonth, annualContributionCents: (amounts[person.key] ?? 0) * 100, cashRatePct: p.cashRatePct }),
  })), [p.people, p.startMonth, p.releaseMonth, p.cashRatePct, amounts])
  const total = results.reduce((s, x) => ({ net: s.net + x.r.netFhssCents, cash: s.cash + x.r.cashPathCents, gain: s.gain + x.r.gainCents, cost: s.cost + x.r.takeHomeCostCents }), { net: 0, cash: 0, gain: 0, cost: 0 })

  if (p.people.length === 0) {
    return (
      <Panel title="FHSS vs cash" icon={<PiggyBank size={14} />} id="fhss">
        <p className="text-sm text-gray-400">Add each person&apos;s gross salary in More › Assumptions to model the First Home Super Saver scheme.</p>
      </Panel>
    )
  }

  return (
    <Panel title="FHSS vs cash" icon={<PiggyBank size={14} />} id="fhss">
      <p className="text-sm text-gray-300">
        Salary-sacrifice into super, then release it for the deposit, compared with taking the same pre-tax pay and saving it in cash at {p.cashRatePct}%.
        Contributions from {mon(p.startMonth)} to {mon(p.releaseMonth)} ({p.fys.join(', ')}).
      </p>

      {results.map(({ person, r }) => (
        <div key={person.key} className="space-y-3 border-t border-gray-800 pt-4">
          <Range id={`fhss-${person.key}`} label={`${person.name}: voluntary contributions a year`} value={amounts[person.key] ?? 0} min={0} max={15_000} step={500}
            onChange={v => setAmounts(a => ({ ...a, [person.key]: v }))} display={`${fmtAUD((amounts[person.key] ?? 0) * 100)}/yr`}
            hint={r.rows.map(x => `${x.fy}: ${fmtAUD(x.contributionCents)} of ${fmtAUD(x.capRoomCents)} cap room${x.limitedBy ? ` (limited by ${x.limitedBy.replaceAll('_', ' ')})` : ''}`).join(' · ')} />
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Released, after tax" value={fmtAUD(r.netFhssCents)} hint={`${fmtAUD(r.releasableContribCents)} + ${fmtAUD(r.deemedEarningsCents)} earnings − ${fmtAUD(r.releaseTaxCents)} tax`} />
            <Stat label="Same pay as cash" value={fmtAUD(r.cashPathCents)} hint={`after ${r.rows[0]?.marginalRatePct ?? 0}% + 2% tax, with interest`} />
            <Stat label="Extra deposit" value={fmtAUD(r.gainCents, { signed: true })} tone={r.gainCents > 0 ? 'good' : r.gainCents < 0 ? 'bad' : undefined} />
          </dl>
          {r.warnings.map(w => <p key={w} className="text-[11px] text-amber-300">{w}</p>)}
        </div>
      ))}

      {results.length > 1 && (
        <dl className="grid grid-cols-3 gap-3 border-t border-gray-800 pt-4">
          <Stat label="Together via FHSS" value={fmtAUD(total.net)} />
          <Stat label="Together as cash" value={fmtAUD(total.cash)} />
          <Stat label="Extra deposit" value={fmtAUD(total.gain, { signed: true })} tone={total.gain > 0 ? 'good' : undefined} hint={`take-home ${fmtAUD(total.cost)} lower meanwhile`} />
        </dl>
      )}

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1.5 text-xs text-amber-100">
        <p className="flex items-center gap-1.5 font-medium text-amber-300"><CalendarClock size={13} /> Timing (ATO rules)</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Request an FHSS determination, then the release, <strong>before you sign</strong> the contract. The model assumes the release lands in {mon(p.releaseMonth)} for a contract in {mon(p.signMonth)}.</li>
          <li>You must sign within {FHSS.signWindowAfterMonths} months after the release request (or up to {FHSS.signWindowBeforeDays} days before it), and tell the ATO within {FHSS.notifyWithinDays} days of signing.</li>
          <li>Release takes about {FHSS.releaseBusinessDays} business days. Contributions count up to {fmtAUD(FHSS.perFyCapCents)} a year and {fmtAUD(FHSS.lifetimeCapCents)} in total per person, and must be in super before you request the determination.</li>
          <li>Salary sacrifice counts toward the concessional cap with employer super. Each financial year&apos;s room closes on 30 June.</li>
          <li>If you don&apos;t buy (or recontribute) in time, a {FHSS.failToBuyTaxPct}% FHSS tax applies.</li>
        </ul>
      </div>
      <Caveat>
        Deemed earnings use the shortfall interest charge ({FHSS.sicRatePct}% p.a., {FHSS.sicQuarter}, changes quarterly), compounded monthly: approximate.
        Release tax is your marginal rate plus Medicare less the 30% offset, worked out with this app&apos;s tax tables. FHSS isn&apos;t added to the Future projection yet.
        A model of the published rules, not advice: the ATO&apos;s determination is what counts.
      </Caveat>
    </Panel>
  )
}

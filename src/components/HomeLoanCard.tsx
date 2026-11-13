import Link from 'next/link'
import type { Route } from 'next'
import { Landmark } from 'lucide-react'
import { fmtAUD, fmtCompact, fmtDate, monthLabel } from '@/lib/format'
import type { HomeLoanStatus, Payoff } from '@/lib/house/homeLoan'

const mon = (mk: string) => monthLabel(mk, { month: 'short', year: 'numeric' })
const yrs = (months: number) => `${Math.floor(months / 12)} yrs${months % 12 ? ` ${months % 12} mo` : ''}`
const payoffText = (p: Payoff) => (p ? `${mon(p.month)} (${yrs(p.months)})` : 'not at this repayment')

/** Home Loan mode summary (Phase 5). Compact on Home; full on House. */
export default function HomeLoanCard({ s, full = false }: { s: HomeLoanStatus; full?: boolean }) {
  const offsetMonths = s.payoff && s.payoffWithoutOffset ? s.payoffWithoutOffset.months - s.payoff.months : null
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
        <Landmark size={13} /> Home loan
        <span className="normal-case tracking-normal text-[10px] px-1.5 rounded bg-gray-800 text-gray-400">{s.source === 'account' ? s.loanName : 'from the plan'}</span>
      </div>
      <div className="flex items-baseline justify-between mt-2 gap-3 flex-wrap">
        <p className="text-white text-lg font-semibold tabular-nums">{fmtAUD(s.balanceCents)} <span className="text-gray-500 text-sm font-normal">owed</span></p>
        {s.offsetName && <p className="text-sm text-gray-300 tabular-nums">{fmtCompact(s.offsetCents)} in {s.offsetName}</p>}
      </div>
      <dl className="grid grid-cols-3 gap-3 mt-3 text-sm">
        <div><dt className="text-[11px] text-gray-500">Rate</dt><dd className="text-white tabular-nums">{s.ratePct}%</dd><dd className="text-[11px] text-gray-500">{s.effectiveRatePct}% after offset</dd></div>
        <div><dt className="text-[11px] text-gray-500">Interest this month</dt><dd className="text-white tabular-nums">{fmtAUD(s.interestThisMonthCents)}</dd>{s.savedByOffsetThisMonthCents > 0 && <dd className="text-[11px] text-green-400">{fmtAUD(s.savedByOffsetThisMonthCents)} saved by offset</dd>}</div>
        <div><dt className="text-[11px] text-gray-500">Paid off</dt><dd className="text-white tabular-nums">{s.payoff ? mon(s.payoff.month) : '—'}</dd>{offsetMonths ? <dd className="text-[11px] text-gray-500">{yrs(offsetMonths)} sooner with offset</dd> : null}</div>
      </dl>
      {full && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-xs text-gray-400">
            Repayment {fmtAUD(s.repaymentCents)}/mo. Paid off {payoffText(s.payoff)}{s.payoff ? `, ${fmtCompact(s.payoff.totalInterestCents)} interest to go` : ''}.
            {' '}Without the offset: {payoffText(s.payoffWithoutOffset)}{s.payoffWithoutOffset && s.payoff ? `, ${fmtCompact(s.payoffWithoutOffset.totalInterestCents - s.payoff.totalInterestCents)} more interest` : ''}.
            {s.balanceAsOf && <> Balance as at {fmtDate(s.balanceAsOf, { day: 'numeric', month: 'short', year: 'numeric' })}.</>}
          </p>
          {s.extras.length > 0 && (
            <table className="w-full text-xs">
              <caption className="text-left text-gray-500 mb-1">Extra repayments (what-if)</caption>
              <thead><tr className="text-gray-500"><th className="text-left font-normal py-1">Extra a month</th><th className="text-right font-normal">Paid off</th><th className="text-right font-normal">Sooner</th><th className="text-right font-normal">Interest saved</th></tr></thead>
              <tbody className="divide-y divide-gray-800">
                {s.extras.map(x => (
                  <tr key={x.extraCents}>
                    <td className="py-1.5 text-gray-200 tabular-nums">+{fmtAUD(x.extraCents)}</td>
                    <td className="text-right tabular-nums text-gray-200">{x.payoff ? mon(x.payoff.month) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-300">{x.monthsSaved !== null ? yrs(x.monthsSaved) : '—'}</td>
                    <td className="text-right tabular-nums text-green-300">{x.interestSavedCents !== null ? fmtCompact(x.interestSavedCents) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.notes.map(n => <p key={n} className="text-[11px] text-amber-300/90">{n}</p>)}
        </div>
      )}
      <p className="text-[11px] text-gray-500 mt-2">
        Every $1 in the offset saves the mortgage rate on $1 of the loan. Payoff dates assume today&apos;s repayment and offset balance continue. Estimate, not a lender statement.
      </p>
    </>
  )
  if (full) return <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5">{body}</section>
  return <Link href={'/house' as Route} className="block bg-gray-900 rounded-2xl border border-gray-800 p-5 hover:border-gray-700 transition-colors">{body}</Link>
}

import { fmtAUD, monthLabel } from '@/lib/format'
import { ledgerGroups, previousTotals } from '@/lib/projection/present'
import type { Projection } from '@/lib/projection/types'

/** "Why did this month move?": every row behind one projected month. */
export default function MonthLedger({ projection, month }: { projection: Projection; month: string }) {
  const m = projection.months.find(x => x.month === month)
  const prev = previousTotals(projection, month)
  if (!m || !prev) return null
  const names = new Map(projection.accounts.map(a => [a.id, a.name]))
  const change = m.netWorthCents - prev.netWorthCents
  const cf = m.cashflow

  return (
    <section id="ledger" className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4 scroll-mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Month ledger · {m.fy}</p>
          <h2 className="text-white font-semibold">{monthLabel(month)}</h2>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold tabular-nums ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtAUD(change, { signed: true })}</p>
          <p className="text-[11px] text-gray-500">net worth change</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {[
          ['Take-home', cf.takeHomeCents + cf.otherIncomeCents],
          ['Spending + planned', -(cf.spendingCents + cf.plannedOutCents)],
          ['Loan repayments', -cf.loanRepaymentCents],
          ['Cash left over', cf.netCashCents],
        ].map(([label, v]) => (
          <div key={label as string} className="bg-gray-800/60 rounded-xl px-3 py-2">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-white tabular-nums font-medium">{fmtAUD(v as number, { signed: (v as number) < 0 })}</dd>
          </div>
        ))}
      </dl>

      {ledgerGroups(m).map(g => (
        <div key={g.key}>
          <div className="flex justify-between text-xs text-gray-500 uppercase tracking-wider mb-1">
            <span>{g.title}</span>
            <span className="tabular-nums normal-case">{g.nwCents ? `${fmtAUD(g.nwCents, { signed: true })} net worth` : ''}</span>
          </div>
          <ul className="divide-y divide-gray-800/70">
            {g.entries.map((t, i) => (
              <li key={i} className="py-1.5 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className={t.memo ? 'text-gray-500' : 'text-gray-200'}>{t.label}{t.memo && <span className="text-[10px] ml-1">(info)</span>}</p>
                  {(t.detail || t.accountId) && (
                    <p className="text-[11px] text-gray-500">
                      {t.accountId && !t.memo ? names.get(t.accountId) ?? '' : ''}
                      {t.accountId && !t.memo && t.detail ? ' · ' : ''}
                      {t.detail}
                    </p>
                  )}
                </div>
                <span className={`tabular-nums flex-shrink-0 ${t.memo ? 'text-gray-500' : t.cents >= 0 ? 'text-green-400' : 'text-gray-200'}`}>
                  {fmtAUD(t.cents, { signed: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <details className="text-xs">
        <summary className="text-gray-400 cursor-pointer">Balances at the end of {monthLabel(month, { month: 'short', year: 'numeric' })}</summary>
        <ul className="mt-2 space-y-1">
          {projection.accounts.filter(a => m.balances[a.id] !== undefined).map(a => (
            <li key={a.id} className="flex justify-between gap-3">
              <span className="text-gray-400">{a.name}{a.synthetic ? ' (modelled)' : ''}</span>
              <span className="text-gray-200 tabular-nums">{fmtAUD(m.balances[a.id], { signed: m.balances[a.id] < 0 })}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

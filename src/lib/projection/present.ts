// Presentation helpers for projection output: chart series and the month
// drill-down ("why did this month move?"). Pure.

import { monthLabel } from '../format'
import type { Projection, ProjectionMonth, TraceEntry, TraceKind } from './types'

export type ChartPoint = { month: string; label: string; netWorth: number; liquid: number; super: number; deposit: number }

/** One point per month in whole dollars, starting with "Now" (opening balances). */
export function chartSeries(p: Projection): ChartPoint[] {
  const d = (c: number) => Math.round(c / 100)
  return [
    { month: 'now', label: 'Now', netWorth: d(p.opening.netWorthCents), liquid: d(p.opening.liquidCents), super: d(p.opening.superCents), deposit: d(p.opening.depositPotCents) },
    ...p.months.map(m => ({
      month: m.month, label: monthLabel(m.month, { month: 'short', year: '2-digit' }),
      netWorth: d(m.netWorthCents), liquid: d(m.liquidCents), super: d(m.superCents), deposit: d(m.depositPotCents),
    })),
  ]
}

export type LedgerGroup = { key: string; title: string; entries: TraceEntry[]; nwCents: number }

const GROUPS: { key: string; title: string; kinds: TraceKind[] }[] = [
  { key: 'pay', title: 'Pay', kinds: ['income', 'tax', 'super'] },
  { key: 'spending', title: 'Spending', kinds: ['spending'] },
  { key: 'planned', title: 'Planned items', kinds: ['planned', 'transfer'] },
  { key: 'loans', title: 'Loans', kinds: ['loan'] },
  { key: 'growth', title: 'Interest & growth', kinds: ['interest', 'growth', 'fees'] },
  { key: 'events', title: 'Life events', kinds: ['event'] },
  { key: 'extra', title: 'What-if', kinds: ['extra'] },
]

/**
 * A month's trace grouped for display. Internal moves between your own
 * accounts appear once (the outgoing leg) so the list reads like a statement.
 */
export function ledgerGroups(m: ProjectionMonth): LedgerGroup[] {
  const out: LedgerGroup[] = []
  for (const g of GROUPS) {
    const entries = m.trace.filter(t => g.kinds.includes(t.kind) && !t.inLeg)
    if (!entries.length) continue
    out.push({ key: g.key, title: g.title, entries, nwCents: entries.reduce((s, t) => s + (t.memo ? 0 : t.nwCents), 0) })
  }
  return out
}

/** The previous month's totals (opening balances for the first month). */
export function previousTotals(p: Projection, month: string) {
  const i = p.months.findIndex(x => x.month === month)
  if (i < 0) return null
  return i === 0 ? p.opening : p.months[i - 1]
}

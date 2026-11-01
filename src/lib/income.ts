import { monthKey } from './format'

type Tx = { date: string; aud_amount_cents: number }

/**
 * Totals per month key (YYYY-MM), as positive cents.
 * kind 'income' sums positive amounts, 'expense' sums the absolute value of negatives.
 */
export function totalsByMonth(txs: readonly Tx[], kind: 'income' | 'expense'): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of txs) {
    const v = t.aud_amount_cents
    if (kind === 'income' ? v <= 0 : v >= 0) continue
    const mk = monthKey(t.date)
    out[mk] = (out[mk] ?? 0) + Math.abs(v)
  }
  return out
}

export type IncomeVsSpendPoint = { mk: string; incomeCents: number; spendCents: number; savingsCents: number }

export function incomeVsSpending(
  monthKeys: readonly string[],
  incomeByMonth: Record<string, number>,
  spendByMonth: Record<string, number>,
): IncomeVsSpendPoint[] {
  return monthKeys.map(mk => {
    const incomeCents = incomeByMonth[mk] ?? 0
    const spendCents  = spendByMonth[mk] ?? 0
    return { mk, incomeCents, spendCents, savingsCents: incomeCents - spendCents }
  })
}

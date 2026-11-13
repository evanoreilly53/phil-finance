// Shared helpers for the rules: month spend history and formatting. Pure.

import { addMonths, monthLabel } from '../format'
import { rootCategoryId, spendByCategory } from '../budgets'
import { BASELINE_EXCLUDE } from '../projection/inputs'
import type { InsightCategory, InsightContext, InsightTx } from './types'

/** The last complete month before `thisMonth`. */
export const lastMonthOf = (thisMonth: string) => addMonths(thisMonth, -1)

/** Months that have any (non-transfer) transaction: "data exists for this month". */
export function monthsWithData(txs: readonly InsightTx[]): Set<string> {
  const s = new Set<string>()
  for (const t of txs) if (!t.is_transfer) s.add(t.date.slice(0, 7))
  return s
}

/** Top-level categories that count as everyday spending (not income, transfers, savings, wedding or one-offs). */
export function spendRoots(categories: readonly InsightCategory[]): InsightCategory[] {
  return categories.filter(c => !c.parent_id && c.kind !== 'income' && c.kind !== 'transfer' && c.kind !== 'savings' && !BASELINE_EXCLUDE.test(c.name))
}

/** Spending per top-level category for each month (transfers excluded, refunds netted). */
export function spendHistory(ctx: Pick<InsightContext, 'transactions' | 'categories'>, months: readonly string[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const m of months) out.set(m, spendByCategory(ctx.transactions, m, ctx.categories, { rollup: true }))
  return out
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/** Transactions of one top-level category in a month, biggest spend first. */
export function categoryTxs(ctx: Pick<InsightContext, 'transactions' | 'categories'>, rootId: string, month: string): InsightTx[] {
  const byId = new Map(ctx.categories.map(c => [c.id, c]))
  return ctx.transactions
    .filter(t => !t.is_transfer && t.date.startsWith(month) && t.category_id && rootCategoryId(t.category_id, byId) === rootId)
    .sort((a, b) => a.aud_amount_cents - b.aud_amount_cents)
}

export const dollars = (cents: number) => `$${Math.round(Math.abs(cents) / 100).toLocaleString('en-AU')}`
export const dollarsCents = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const mon = (mk: string) => monthLabel(mk, { month: 'short', year: 'numeric' })
export const monthName = (mk: string) => monthLabel(mk, { month: 'long' })
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function txEvidence(t: InsightTx) {
  return {
    kind: 'tx' as const, id: t.id, date: t.date, description: t.description, cents: t.aud_amount_cents,
    ...(t.currency && t.currency !== 'AUD' ? { currency: t.currency, nativeCents: t.amount_cents } : {}),
  }
}

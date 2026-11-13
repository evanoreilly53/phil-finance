// Home "monthly check-in" numbers. Pure.

import { budgetsForMonth, spendByCategory, type BudgetRow, type CategoryNode, type SpendTx } from './budgets'
import type { MonthlyNetWorth } from './balances'

export type MonthSummary = {
  spentCents: number
  /** Sum of the top-level monthly targets in force (0 = no budgets set). */
  budgetCents: number
  incomeCents: number
  savedCents: number
  /** Saved ÷ income, or null with no income yet. */
  savedPct: number | null
}

/**
 * This month so far: spending (transfers excluded, refunds netted) vs the sum
 * of budgets, and money in (salary / income categories or uncategorised money
 * in; refunds to spending categories are already netted off spending).
 */
export function monthSummary(
  txs: readonly SpendTx[],
  categories: readonly CategoryNode[],
  budgets: readonly BudgetRow[],
  month: string,
): MonthSummary {
  let spent = 0
  for (const v of spendByCategory(txs, month, categories, { rollup: true }).values()) spent += v
  const byId = new Map(categories.map(c => [c.id, c]))
  let budget = 0
  for (const [id, cents] of budgetsForMonth(budgets, month)) if (!byId.get(id)?.parent_id) budget += cents
  let income = 0
  for (const t of txs) {
    if (t.is_transfer || !t.date.startsWith(month) || t.aud_amount_cents <= 0) continue
    const kind = t.category_id ? byId.get(t.category_id)?.kind : null
    if (!t.category_id || kind === 'income') income += t.aud_amount_cents
  }
  const saved = income - spent
  return { spentCents: spent, budgetCents: budget, incomeCents: income, savedCents: saved, savedPct: income > 0 ? saved / income : null }
}

/** Latest month-end net worth and the change on the month before. */
export function netWorthChange(series: readonly MonthlyNetWorth[]): { mk: string; cents: number; changeCents: number | null } | null {
  if (!series.length) return null
  const last = series[series.length - 1]
  const prev = series.length > 1 ? series[series.length - 2] : null
  return { mk: last.mk, cents: last.cents, changeCents: prev ? last.cents - prev.cents : null }
}

// Light monthly budgets + transfer-aware spending aggregation. Pure.

import type { CategoryKind } from './supabase/database.types'

export type BudgetRow = { category_id: string; monthly_cents: number; effective_from: string }
export type SpendTx = { date: string; aud_amount_cents: number; category_id: string | null; is_transfer?: boolean | null }
export type CategoryNode = { id: string; parent_id: string | null; kind?: CategoryKind | null }

export const UNCATEGORISED = 'uncategorised'

/** The target in force for each category in `month` (YYYY-MM): latest effective_from ≤ month. */
export function budgetsForMonth(budgets: readonly BudgetRow[], month: string): Map<string, number> {
  const start = `${month}-01`
  const best = new Map<string, BudgetRow>()
  for (const b of budgets) {
    if (b.effective_from > start) continue
    const cur = best.get(b.category_id)
    if (!cur || b.effective_from > cur.effective_from) best.set(b.category_id, b)
  }
  return new Map([...best].map(([k, v]) => [k, v.monthly_cents]))
}

/** Top-level ancestor of a category (cycle-safe). */
export function rootCategoryId(id: string, byId: ReadonlyMap<string, CategoryNode>): string {
  let cur = byId.get(id)
  const seen = new Set<string>()
  while (cur?.parent_id && !seen.has(cur.id)) {
    seen.add(cur.id)
    const parent = byId.get(cur.parent_id)
    if (!parent) break
    cur = parent
  }
  return cur?.id ?? id
}

/**
 * Spending per category for one month, as positive cents.
 * - Transfers between own accounts are excluded.
 * - Expenses count; positive rows count only as refunds against a non-income
 *   category (so salary never shows up as "negative spending").
 * - Income- and transfer-kind categories are excluded.
 * - `rollup` totals children into their top-level parent.
 */
export function spendByCategory(
  txs: readonly SpendTx[],
  month: string,
  categories: readonly CategoryNode[],
  opts: { rollup?: boolean } = {},
): Map<string, number> {
  const byId = new Map(categories.map(c => [c.id, c]))
  const out = new Map<string, number>()
  for (const t of txs) {
    if (t.is_transfer || !t.date.startsWith(month)) continue
    const cat = t.category_id ? byId.get(t.category_id) : undefined
    const kind = cat?.kind ?? null
    if (kind === 'income' || kind === 'transfer') continue
    if (t.aud_amount_cents > 0 && !cat) continue // uncategorised money in: not a refund we can place
    const key = !t.category_id ? UNCATEGORISED : opts.rollup ? rootCategoryId(t.category_id, byId) : t.category_id
    out.set(key, (out.get(key) ?? 0) - t.aud_amount_cents)
  }
  return out
}

export type BudgetStatus = 'under' | 'near' | 'over'

export function budgetProgress(spentCents: number, targetCents: number, nearAt = 0.85):
  { pct: number; remainingCents: number; status: BudgetStatus } {
  const pct = targetCents > 0 ? spentCents / targetCents : spentCents > 0 ? Infinity : 0
  return {
    pct,
    remainingCents: targetCents - spentCents,
    status: pct > 1 ? 'over' : pct >= nearAt ? 'near' : 'under',
  }
}

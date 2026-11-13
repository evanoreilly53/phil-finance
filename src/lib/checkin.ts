// Home "monthly check-in" numbers. Pure.

import { budgetsForMonth, spendByCategory, type BudgetRow, type CategoryNode, type SpendTx } from './budgets'
import { latestBalanceByAccount, type BalanceSnapshot, type MonthlyNetWorth } from './balances'
import { addMonths } from './format'
import { monthEnd } from './projection/schedule'

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

export type NetWorthExplained = {
  month: string
  startCents: number
  endCents: number
  changeCents: number
  /** Ledger rows that add up exactly to changeCents. */
  rows: { key: string; label: string; cents: number; detail?: string }[]
  /** Per-account change (carry-forward balances), biggest first. */
  accounts: { id: string; name: string; startCents: number; endCents: number; changeCents: number; updated: boolean }[]
}

/**
 * Why net worth moved in `month`: month-end balances (each account's last
 * known balance carried forward) vs the month before, split into recorded
 * money in, recorded spending, and everything else (investment and super
 * growth, interest, accounts not updated, cash outside tracked accounts).
 * The rows add up exactly to the change.
 */
export function explainNetWorth(p: {
  month: string
  snapshots: readonly BalanceSnapshot[]
  accounts: readonly { id: string; name: string }[]
  txs: readonly SpendTx[]
  categories: readonly CategoryNode[]
}): NetWorthExplained {
  const ids = new Set(p.accounts.map(a => a.id))
  const prevEnd = monthEnd(addMonths(p.month, -1))
  const end = monthEnd(p.month)
  const before = latestBalanceByAccount(p.snapshots, { accountIds: ids, asOf: prevEnd })
  const after = latestBalanceByAccount(p.snapshots, { accountIds: ids, asOf: end })
  const accounts = p.accounts.map(a => {
    const s = before.get(a.id)?.cents ?? 0
    const e = after.get(a.id)?.cents ?? 0
    const d = after.get(a.id)?.date
    return { id: a.id, name: a.name, startCents: s, endCents: e, changeCents: e - s, updated: !!d && d > prevEnd }
  }).filter(a => a.startCents !== 0 || a.endCents !== 0)
    .sort((x, y) => Math.abs(y.changeCents) - Math.abs(x.changeCents))
  const startCents = accounts.reduce((s, a) => s + a.startCents, 0)
  const endCents = accounts.reduce((s, a) => s + a.endCents, 0)
  const m = monthSummary(p.txs, p.categories, [], p.month)
  const other = endCents - startCents - m.incomeCents + m.spentCents
  const stale = accounts.filter(a => !a.updated).length
  return {
    month: p.month, startCents, endCents, changeCents: endCents - startCents, accounts,
    rows: [
      { key: 'income', label: 'Money in (pay and other income)', cents: m.incomeCents },
      { key: 'spending', label: 'Spending (transfers excluded)', cents: -m.spentCents },
      { key: 'other', label: 'Growth, interest and untracked', cents: other,
        detail: `Investment and super movements, interest, cash spent from accounts without transactions${stale ? `; ${stale} account${stale === 1 ? '' : 's'} not updated this month (carried forward)` : ''}.` },
    ],
  }
}

/** Latest month-end net worth and the change on the month before. */
export function netWorthChange(series: readonly MonthlyNetWorth[]): { mk: string; cents: number; changeCents: number | null } | null {
  if (!series.length) return null
  const last = series[series.length - 1]
  const prev = series.length > 1 ? series[series.length - 2] : null
  return { mk: last.mk, cents: last.cents, changeCents: prev ? last.cents - prev.cents : null }
}

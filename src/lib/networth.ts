import { fmtDate } from './format'
import { netWorthSeries, type BalanceSnapshot } from './balances'

// Account-type groupings for the Net Worth chart (colours live in NetWorthChart).
// Every account type in the schema must belong to a group, otherwise the
// stacked lines would not add up to the headline total.
export const NW_CHART_GROUPS = [
  { key: 'investments', types: ['investment', 'property', 'other_asset'] },
  { key: 'super',       types: ['super'] },
  { key: 'bank',        types: ['bank', 'savings', 'wedding', 'offset', 'cash'] },
  // Liabilities (Phase 1): balances are negative, so this line sits below zero
  { key: 'debts',       types: ['credit_card', 'mortgage', 'loan', 'other_liability'] },
] as const

type AccountLike = { id: string; type: string }

/**
 * Net Worth chart points (dollars), one per snapshot date, with each account's
 * last known balance carried forward. Only the given accounts are included.
 */
export function buildNetWorthChartData(
  snapshots: readonly BalanceSnapshot[],
  accounts: readonly AccountLike[],
): Record<string, number | string>[] {
  const typeById = new Map(accounts.map(a => [a.id, a.type]))
  const series = netWorthSeries(snapshots, { accountIds: new Set(typeById.keys()) })

  return series.map(p => {
    const point: Record<string, number | string> = {
      date:  p.date,
      label: fmtDate(p.date, { month: 'short', year: '2-digit' }),
    }
    for (const g of NW_CHART_GROUPS) {
      let groupCents = 0
      for (const [id, cents] of p.byAccount) {
        if ((g.types as readonly string[]).includes(typeById.get(id) ?? '')) groupCents += cents
      }
      point[g.key] = Math.round(groupCents / 100)
    }
    // Total is every included account, so it always matches the headline NW.
    point.total = Math.round(p.totalCents / 100)
    return point
  })
}

// ── Historical milestone detection (Net Worth chart pins) ─────────────────────

const MILESTONES = [50_000, 100_000, 150_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000]

export type Milestone = { dollars: number; label: string; date: string }

/** First date each round-number net worth was crossed. chartData: `date` + `total` (dollars). */
export function detectMilestones(chartData: Record<string, number | string>[]): Milestone[] {
  const results: Milestone[] = []
  for (const m of MILESTONES) {
    for (let i = 0; i < chartData.length; i++) {
      const total = chartData[i].total as number
      const prev  = i > 0 ? (chartData[i - 1].total as number) : 0
      if (total >= m && prev < m) {
        results.push({ dollars: m, label: m >= 1_000_000 ? `$${m / 1_000_000}M` : `$${m / 1_000}k`, date: chartData[i].date as string })
        break
      }
    }
  }
  return results
}

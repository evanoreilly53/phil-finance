import { addMonths, monthKey, monthLabel } from './format'

// ── Least-squares slope (monthly gain, same units as input) ───────────────────

export function linearMonthlyGain(values: number[]): number {
  const pts = values.slice(-6)
  const n   = pts.length
  if (n < 2) return 0
  const xBar = (n - 1) / 2
  const yBar = pts.reduce((s, v) => s + v, 0) / n
  const num  = pts.reduce((s, v, i) => s + (i - xBar) * (v - yBar), 0)
  const den  = pts.reduce((s, _,  i) => s + (i - xBar) ** 2, 0)
  return den === 0 ? 0 : num / den
}

// ── Project future NW data points ────────────────────────────────────────────
// chartData must have a `date` (YYYY-MM-DD) and `total` (dollars) field.
// Returns projected points with `projected_total` (dollars) only.

export function projectNetWorth(
  chartData: Record<string, number | string>[],
  futureMonths: number,
): Record<string, number | string>[] {
  if (chartData.length < 2) return []
  const slope     = linearMonthlyGain(chartData.map(d => d.total as number))
  const lastDate  = chartData[chartData.length - 1].date as string
  const lastTotal = chartData[chartData.length - 1].total as number
  const lastMK    = monthKey(lastDate)

  return Array.from({ length: futureMonths }, (_, i) => {
    const mk = addMonths(lastMK, i + 1)
    return {
      date:            `${mk}-15`,
      label:           monthLabel(mk, { month: 'short', year: '2-digit' }),
      projected_total: Math.max(0, Math.round(lastTotal + slope * (i + 1))),
    }
  })
}

// ── Months until a target is reached at the current slope ────────────────────

export function monthsToTarget(
  currentDollars: number,
  targetDollars:  number,
  slopeDollars:   number,
): number | null {
  if (slopeDollars <= 0 || currentDollars >= targetDollars) return null
  return Math.ceil((targetDollars - currentDollars) / slopeDollars)
}

// ── Monthly NW series from raw snapshots ─────────────────────────────────────
// Returns [{monthKey, totalDollars}] sorted oldest→newest.

export function buildMonthlyNW(
  snapshots: { date: string; account_id: string; aud_balance_cents: number }[],
): { mk: string; dollars: number }[] {
  // Per month: latest snapshot per account → sum
  const byMonth = new Map<string, Map<string, { date: string; cents: number }>>()

  for (const s of snapshots) {
    const mk = monthKey(s.date)
    if (!byMonth.has(mk)) byMonth.set(mk, new Map())
    const accts = byMonth.get(mk)!
    const prev  = accts.get(s.account_id)
    if (!prev || s.date > prev.date) accts.set(s.account_id, { date: s.date, cents: s.aud_balance_cents })
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mk, accts]) => ({
      mk,
      dollars: Math.round([...accts.values()].reduce((s, v) => s + v.cents, 0) / 100),
    }))
}

// ── Milestone detection ───────────────────────────────────────────────────────

const MILESTONES = [50_000, 100_000, 150_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000]

export type Milestone = { dollars: number; label: string; date: string }

export function detectMilestones(
  chartData: Record<string, number | string>[],
): Milestone[] {
  const results: Milestone[] = []
  for (const m of MILESTONES) {
    for (let i = 0; i < chartData.length; i++) {
      const total = chartData[i].total as number
      const prev  = i > 0 ? (chartData[i - 1].total as number) : 0
      if (total >= m && prev < m) {
        results.push({
          dollars: m,
          label:   m >= 1_000_000 ? `$${m / 1_000_000}M` : `$${m / 1_000}k`,
          date:    chartData[i].date as string,
        })
        break
      }
    }
  }
  return results
}

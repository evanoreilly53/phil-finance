import type { OwnerKey } from './types'

type Snapshot = {
  account_id: string
  date: string
  aud_balance_cents: number
}

type Transaction = {
  date: string
  aud_amount_cents: number
  owner: OwnerKey
}

export type MonthAggregate = {
  joint: number
  rachel: number
  evan: number
  total: number
}

export function latestSnapshotsByAccount(snapshots: Snapshot[]): Record<string, Snapshot> {
  const latest: Record<string, Snapshot> = {}
  for (const snap of snapshots) {
    if (!latest[snap.account_id] || snap.date > latest[snap.account_id].date) {
      latest[snap.account_id] = snap
    }
  }
  return latest
}

// Single-pass aggregation of expense transactions by month key.
// Only processes negative aud_amount_cents (expenses).
export function monthlyExpenseMap(txs: Transaction[]): Map<string, MonthAggregate> {
  const map = new Map<string, MonthAggregate>()
  for (const t of txs) {
    if (t.aud_amount_cents >= 0) continue
    const key = t.date.slice(0, 7)
    if (!map.has(key)) map.set(key, { joint: 0, rachel: 0, evan: 0, total: 0 })
    const agg = map.get(key)!
    const abs = Math.abs(t.aud_amount_cents)
    agg[t.owner] += abs
    agg.total    += abs
  }
  return map
}

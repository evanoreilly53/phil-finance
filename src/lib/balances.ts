import { addMonths, monthKey } from './format'

// ── Account balance / net-worth helpers ──────────────────────────────────────
// Single source of truth for "what was each account worth at a point in time".
//
// Snapshots are sparse and manual: one account may be updated on the 3rd and
// another on the 20th. Every helper here CARRIES FORWARD each account's last
// known balance until a newer snapshot replaces it, so a total never "drops"
// just because an account wasn't re-entered on that particular day.
//
// All money is integer cents (AUD).

export type BalanceSnapshot = {
  date: string              // YYYY-MM-DD
  account_id: string
  aud_balance_cents: number
}

export type LatestBalance = { date: string; cents: number }

type Opts = {
  /** Only include these accounts (e.g. active accounts). Omit to include all. */
  accountIds?: ReadonlySet<string>
}

function included(id: string, opts?: Opts): boolean {
  return !opts?.accountIds || opts.accountIds.has(id)
}

function sortedByDate<T extends BalanceSnapshot>(snaps: readonly T[]): T[] {
  return snaps.slice().sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Latest snapshot row per account (the full row), optionally as of a date (inclusive).
 */
export function latestSnapshotByAccount<T extends BalanceSnapshot>(
  snaps: readonly T[],
  opts?: Opts & { asOf?: string },
): Map<string, T> {
  const out = new Map<string, T>()
  for (const s of snaps) {
    if (!included(s.account_id, opts)) continue
    if (opts?.asOf && s.date > opts.asOf) continue
    const prev = out.get(s.account_id)
    if (!prev || s.date > prev.date) out.set(s.account_id, s)
  }
  return out
}

/**
 * Latest balance per account, optionally as of a given date (inclusive).
 */
export function latestBalanceByAccount(
  snaps: readonly BalanceSnapshot[],
  opts?: Opts & { asOf?: string },
): Map<string, LatestBalance> {
  const out = new Map<string, LatestBalance>()
  for (const [id, s] of latestSnapshotByAccount(snaps, opts)) {
    out.set(id, { date: s.date, cents: s.aud_balance_cents })
  }
  return out
}

/** Sum of each account's latest balance (cents). */
export function currentNetWorthCents(snaps: readonly BalanceSnapshot[], opts?: Opts): number {
  let total = 0
  for (const v of latestBalanceByAccount(snaps, opts).values()) total += v.cents
  return total
}

export type NetWorthPoint = {
  date: string
  totalCents: number
  /** Carried-forward balance of every account known as of `date`. */
  byAccount: Map<string, number>
}

/**
 * One point per distinct snapshot date. Each point's total includes every
 * account's most recent balance on or before that date (carry-forward).
 */
export function netWorthSeries(snaps: readonly BalanceSnapshot[], opts?: Opts): NetWorthPoint[] {
  const current = new Map<string, number>()
  const points: NetWorthPoint[] = []
  for (const s of sortedByDate(snaps)) {
    if (!included(s.account_id, opts)) continue
    current.set(s.account_id, s.aud_balance_cents)
    const last = points[points.length - 1]
    const snapshot = new Map(current)
    const totalCents = sumValues(snapshot)
    if (last && last.date === s.date) {
      last.byAccount = snapshot
      last.totalCents = totalCents
    } else {
      points.push({ date: s.date, totalCents, byAccount: snapshot })
    }
  }
  return points
}

export type MonthlyNetWorth = { mk: string; cents: number }

/**
 * Month-end net worth for every calendar month from the first snapshot month
 * to the last (gap months included, carried forward). Because there is exactly
 * one point per month, the index can safely be used as "months" for slope maths.
 */
export function monthlyNetWorth(snaps: readonly BalanceSnapshot[], opts?: Opts): MonthlyNetWorth[] {
  const series = netWorthSeries(snaps, opts)
  if (series.length === 0) return []

  // Last point in each month = month-end position
  const endOfMonth = new Map<string, number>()
  for (const p of series) endOfMonth.set(monthKey(p.date), p.totalCents)

  const firstMK = monthKey(series[0].date)
  const lastMK  = monthKey(series[series.length - 1].date)
  const out: MonthlyNetWorth[] = []
  let carried = 0
  for (let mk = firstMK; mk <= lastMK; mk = addMonths(mk, 1)) {
    if (endOfMonth.has(mk)) carried = endOfMonth.get(mk)!
    out.push({ mk, cents: carried })
  }
  return out
}

/**
 * For each account: its latest balance and the balance of its own previous
 * snapshot (null if it only has one). Used for per-account deltas.
 */
export function accountDeltas(
  snaps: readonly BalanceSnapshot[],
  opts?: Opts,
): Map<string, { latest: LatestBalance; previous: LatestBalance | null }> {
  const out = new Map<string, { latest: LatestBalance; previous: LatestBalance | null }>()
  for (const s of sortedByDate(snaps)) {
    if (!included(s.account_id, opts)) continue
    const cur  = out.get(s.account_id)
    const next = { date: s.date, cents: s.aud_balance_cents }
    if (!cur) out.set(s.account_id, { latest: next, previous: null })
    else if (s.date !== cur.latest.date) out.set(s.account_id, { latest: next, previous: cur.latest })
    else out.set(s.account_id, { latest: next, previous: cur.previous })
  }
  return out
}

function sumValues(m: Map<string, number>): number {
  let t = 0
  for (const v of m.values()) t += v
  return t
}

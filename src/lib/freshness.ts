// Data freshness: how current each account's numbers are. Pure.

import type { AccountType } from './supabase/database.types'
import { dayDiff } from './import/dates'

export type FreshnessStatus = 'fresh' | 'ageing' | 'stale' | 'never'

// Everyday accounts should be imported roughly weekly; super/investments/loans
// are updated from statements, so a month or two is normal.
const TRANSACTIONAL: ReadonlySet<AccountType> = new Set(['bank', 'savings', 'offset', 'credit_card', 'wedding', 'cash'])

export function freshnessThresholds(type: AccountType): { fresh: number; ageing: number } {
  return TRANSACTIONAL.has(type) ? { fresh: 7, ageing: 31 } : { fresh: 35, ageing: 95 }
}

export function freshness(asOf: string | null, today: string, type: AccountType):
  { status: FreshnessStatus; days: number | null } {
  if (!asOf) return { status: 'never', days: null }
  const days = Math.max(0, dayDiff(asOf, today))
  const t = freshnessThresholds(type)
  return { status: days <= t.fresh ? 'fresh' : days <= t.ageing ? 'ageing' : 'stale', days }
}

/** "today", "yesterday", "12 days ago", "never". */
export function agoLabel(days: number | null): string {
  if (days === null) return 'never'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Worst status first, for a one-line summary ("2 accounts stale"). */
export function worstFirst<T extends { status: FreshnessStatus }>(items: readonly T[]): T[] {
  const rank: Record<FreshnessStatus, number> = { never: 0, stale: 1, ageing: 2, fresh: 3 }
  return [...items].sort((a, b) => rank[a.status] - rank[b.status])
}

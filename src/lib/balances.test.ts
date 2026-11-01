import { describe, it, expect } from 'vitest'
import {
  latestBalanceByAccount, latestSnapshotByAccount, currentNetWorthCents,
  netWorthSeries, monthlyNetWorth, accountDeltas,
} from './balances'

const snap = (date: string, account_id: string, aud_balance_cents: number) => ({ date, account_id, aud_balance_cents })

// Super updated on a different day from the banks: the classic false-dip case
const staggered = [
  snap('2026-01-05', 'bank',  1_000_00),
  snap('2026-01-05', 'super', 50_000_00),
  snap('2026-02-03', 'bank',  2_000_00),   // super not re-entered this day
  snap('2026-02-20', 'super', 52_000_00),  // bank not re-entered this day
]

describe('latestBalanceByAccount', () => {
  it('picks the newest snapshot per account regardless of input order', () => {
    const m = latestBalanceByAccount([...staggered].reverse())
    expect(m.get('bank')).toEqual({ date: '2026-02-03', cents: 2_000_00 })
    expect(m.get('super')).toEqual({ date: '2026-02-20', cents: 52_000_00 })
  })
  it('respects asOf (inclusive) and accountIds', () => {
    const m = latestBalanceByAccount(staggered, { asOf: '2026-02-03', accountIds: new Set(['super']) })
    expect([...m.keys()]).toEqual(['super'])
    expect(m.get('super')!.cents).toBe(50_000_00)
  })
  it('latestSnapshotByAccount returns the full row', () => {
    const rows = [{ ...snap('2026-01-01', 'a', 5), id: 'x' }, { ...snap('2026-02-01', 'a', 7), id: 'y' }]
    expect(latestSnapshotByAccount(rows).get('a')!.id).toBe('y')
  })
})

describe('currentNetWorthCents', () => {
  it('sums each account latest balance', () => {
    expect(currentNetWorthCents(staggered)).toBe(2_000_00 + 52_000_00)
  })
  it('excludes accounts not in accountIds (e.g. inactive)', () => {
    expect(currentNetWorthCents(staggered, { accountIds: new Set(['bank']) })).toBe(2_000_00)
  })
  it('is 0 with no snapshots', () => {
    expect(currentNetWorthCents([])).toBe(0)
  })
})

describe('netWorthSeries (carry-forward)', () => {
  it('never drops an account just because it was not snapshotted that day', () => {
    const s = netWorthSeries(staggered)
    expect(s.map(p => [p.date, p.totalCents])).toEqual([
      ['2026-01-05', 51_000_00],
      ['2026-02-03', 52_000_00], // old code: 2,000 (super missing), a false crash
      ['2026-02-20', 54_000_00], // old code: 52,000 (bank missing)
    ])
  })
  it('collapses multiple snapshots on the same date into one point', () => {
    const s = netWorthSeries([snap('2026-01-01', 'a', 1), snap('2026-01-01', 'b', 2)])
    expect(s).toHaveLength(1)
    expect(s[0].totalCents).toBe(3)
    expect(s[0].byAccount.get('a')).toBe(1)
  })
  it('handles unsorted input', () => {
    const s = netWorthSeries([...staggered].reverse())
    expect(s[s.length - 1].totalCents).toBe(54_000_00)
  })
  it('last point equals currentNetWorthCents', () => {
    const s = netWorthSeries(staggered)
    expect(s[s.length - 1].totalCents).toBe(currentNetWorthCents(staggered))
  })
})

describe('monthlyNetWorth', () => {
  it('uses month-end carried-forward totals and fills gap months', () => {
    const m = monthlyNetWorth([...staggered, snap('2026-05-10', 'bank', 3_000_00)])
    expect(m).toEqual([
      { mk: '2026-01', cents: 51_000_00 },
      { mk: '2026-02', cents: 54_000_00 },
      { mk: '2026-03', cents: 54_000_00 },
      { mk: '2026-04', cents: 54_000_00 },
      { mk: '2026-05', cents: 55_000_00 },
    ])
  })
  it('spans a year boundary', () => {
    const m = monthlyNetWorth([snap('2025-12-31', 'a', 100), snap('2026-01-01', 'a', 200)])
    expect(m).toEqual([{ mk: '2025-12', cents: 100 }, { mk: '2026-01', cents: 200 }])
  })
  it('returns [] for no snapshots', () => {
    expect(monthlyNetWorth([])).toEqual([])
  })
})

describe('accountDeltas', () => {
  it('compares each account against its own previous snapshot', () => {
    const d = accountDeltas(staggered)
    expect(d.get('bank')).toEqual({
      latest:   { date: '2026-02-03', cents: 2_000_00 },
      previous: { date: '2026-01-05', cents: 1_000_00 },
    })
    expect(d.get('super')!.previous!.cents).toBe(50_000_00)
  })
  it('previous is null for a single snapshot', () => {
    expect(accountDeltas([snap('2026-01-01', 'a', 1)]).get('a')!.previous).toBeNull()
  })
})

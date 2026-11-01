import { describe, it, expect } from 'vitest'
import { linearMonthlyGain, projectNetWorth, monthsToTarget, buildMonthlyNW, detectMilestones } from './forecast'

describe('linearMonthlyGain', () => {
  it('is the exact slope of a straight line', () => {
    expect(linearMonthlyGain([100, 200, 300, 400])).toBeCloseTo(100)
  })
  it('only uses the last 6 points', () => {
    expect(linearMonthlyGain([0, 0, 0, 10, 20, 30, 40, 50, 60])).toBeCloseTo(10)
  })
  it('is 0 for fewer than 2 points or flat data', () => {
    expect(linearMonthlyGain([])).toBe(0)
    expect(linearMonthlyGain([5])).toBe(0)
    expect(linearMonthlyGain([5, 5, 5])).toBe(0)
  })
})

describe('projectNetWorth', () => {
  const chart = [
    { date: '2026-01-10', total: 1000 },
    { date: '2026-01-20', total: 2000 },
  ]
  it('uses the supplied monthly slope instead of the per-snapshot slope', () => {
    const p = projectNetWorth(chart, 2, 100)
    expect(p.map(x => x.projected_total)).toEqual([2100, 2200])
    expect(p.map(x => x.date)).toEqual(['2026-02-15', '2026-03-15'])
  })
  it('falls back to regression over chart points when no slope is given', () => {
    expect(projectNetWorth(chart, 1)[0].projected_total).toBe(3000)
  })
  it('returns [] with fewer than 2 points', () => {
    expect(projectNetWorth([chart[0]], 3, 100)).toEqual([])
  })
})

describe('monthsToTarget', () => {
  it('rounds up', () => expect(monthsToTarget(100, 350, 100)).toBe(3))
  it('is null when already there or not growing', () => {
    expect(monthsToTarget(500, 400, 10)).toBeNull()
    expect(monthsToTarget(100, 400, 0)).toBeNull()
    expect(monthsToTarget(100, 400, -5)).toBeNull()
  })
})

describe('buildMonthlyNW', () => {
  it('returns one carried-forward dollar value per calendar month', () => {
    const r = buildMonthlyNW([
      { date: '2026-01-05', account_id: 'a', aud_balance_cents: 100_00 },
      { date: '2026-01-05', account_id: 'b', aud_balance_cents: 50_00 },
      { date: '2026-03-02', account_id: 'a', aud_balance_cents: 200_00 },
    ])
    // Old behaviour: Mar = $200 only (b missing) and no Feb point at all
    expect(r).toEqual([
      { mk: '2026-01', dollars: 150 },
      { mk: '2026-02', dollars: 150 },
      { mk: '2026-03', dollars: 250 },
    ])
  })
  it('two snapshots in one month give one point, so the slope stays per-month', () => {
    const r = buildMonthlyNW([
      { date: '2026-01-01', account_id: 'a', aud_balance_cents: 0 },
      { date: '2026-01-15', account_id: 'a', aud_balance_cents: 100_00 },
      { date: '2026-02-01', account_id: 'a', aud_balance_cents: 200_00 },
    ])
    expect(r.map(x => x.dollars)).toEqual([100, 200])
    expect(linearMonthlyGain(r.map(x => x.dollars))).toBeCloseTo(100)
  })
  it('honours accountIds', () => {
    const r = buildMonthlyNW(
      [
        { date: '2026-01-01', account_id: 'a', aud_balance_cents: 1_00 },
        { date: '2026-01-01', account_id: 'x', aud_balance_cents: 9_00 },
      ],
      { accountIds: new Set(['a']) },
    )
    expect(r).toEqual([{ mk: '2026-01', dollars: 1 }])
  })
})

describe('detectMilestones', () => {
  it('reports the first crossing of each milestone', () => {
    const m = detectMilestones([
      { date: '2026-01-01', total: 40_000 },
      { date: '2026-02-01', total: 60_000 },
      { date: '2026-03-01', total: 45_000 },
      { date: '2026-04-01', total: 110_000 },
    ])
    expect(m.map(x => [x.label, x.date])).toEqual([['$50k', '2026-02-01'], ['$100k', '2026-04-01']])
  })
})

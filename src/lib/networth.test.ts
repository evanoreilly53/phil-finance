import { describe, it, expect } from 'vitest'
import { buildNetWorthChartData } from './networth'

const accounts = [
  { id: 'b', type: 'bank' },
  { id: 's', type: 'super' },
  { id: 'i', type: 'investment' },
  { id: 'w', type: 'wedding' },
]
const snap = (date: string, account_id: string, dollars: number) => ({ date, account_id, aud_balance_cents: dollars * 100 })

describe('buildNetWorthChartData', () => {
  it('carries balances forward into each group and the total', () => {
    const data = buildNetWorthChartData([
      snap('2026-01-01', 'b', 100), snap('2026-01-01', 's', 1000), snap('2026-01-01', 'i', 500),
      snap('2026-01-15', 'b', 150),
    ], accounts)
    expect(data[1]).toMatchObject({ date: '2026-01-15', bank: 150, super: 1000, investments: 500, total: 1650 })
  })
  it('groups add up to the total (wedding counted under bank)', () => {
    const [p] = buildNetWorthChartData([snap('2026-01-01', 'b', 1), snap('2026-01-01', 'w', 2), snap('2026-01-01', 's', 3)], accounts)
    expect((p.bank as number) + (p.super as number) + (p.investments as number)).toBe(p.total)
    expect(p.total).toBe(6)
  })
  it('puts liabilities in a debts group that still sums to the total', () => {
    const accs = [...accounts, { id: 'cc', type: 'credit_card' }, { id: 'o', type: 'offset' }]
    const [p] = buildNetWorthChartData([snap('2026-01-01', 'b', 10), snap('2026-01-01', 'cc', -4), snap('2026-01-01', 'o', 5)], accs)
    expect(p).toMatchObject({ bank: 15, debts: -4, total: 11 })
  })
  it('ignores snapshots for accounts not passed in (inactive)', () => {
    const [p] = buildNetWorthChartData([snap('2026-01-01', 'b', 1), snap('2026-01-01', 'gone', 999)], accounts)
    expect(p.total).toBe(1)
  })
})

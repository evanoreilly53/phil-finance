import { describe, it, expect } from 'vitest'
import { totalsByMonth, incomeVsSpending } from './income'

const tx = (date: string, aud_amount_cents: number) => ({ date, aud_amount_cents })

describe('totalsByMonth', () => {
  const txs = [tx('2026-01-02', 500_00), tx('2026-01-09', -120_00), tx('2026-01-30', -30_00), tx('2026-02-01', 100_00)]
  it('sums income (positives)', () => {
    expect(totalsByMonth(txs, 'income')).toEqual({ '2026-01': 500_00, '2026-02': 100_00 })
  })
  it('sums expenses as positive cents', () => {
    expect(totalsByMonth(txs, 'expense')).toEqual({ '2026-01': 150_00 })
  })
})

describe('incomeVsSpending', () => {
  it('reports real spending (was always 0 when only income rows were loaded)', () => {
    const r = incomeVsSpending(['2026-01', '2026-02'], { '2026-01': 500_00 }, { '2026-01': 150_00, '2026-02': 20_00 })
    expect(r).toEqual([
      { mk: '2026-01', incomeCents: 500_00, spendCents: 150_00, savingsCents: 350_00 },
      { mk: '2026-02', incomeCents: 0,      spendCents: 20_00,  savingsCents: -20_00 },
    ])
  })
})

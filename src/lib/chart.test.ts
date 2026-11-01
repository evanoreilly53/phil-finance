import { describe, it, expect } from 'vitest'
import { monthlyExpenseMap } from './chart'

describe('monthlyExpenseMap', () => {
  it('aggregates only expenses by month and owner', () => {
    const m = monthlyExpenseMap([
      { date: '2026-01-02', aud_amount_cents: -100, owner: 'evan' },
      { date: '2026-01-05', aud_amount_cents: -50,  owner: 'joint' },
      { date: '2026-01-06', aud_amount_cents: 999,  owner: 'joint' },
      { date: '2026-02-01', aud_amount_cents: -10,  owner: 'rachel' },
    ])
    expect(m.get('2026-01')).toEqual({ joint: 50, rachel: 0, evan: 100, total: 150 })
    expect(m.get('2026-02')!.total).toBe(10)
  })
})

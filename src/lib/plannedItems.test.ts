import { describe, it, expect } from 'vitest'
import { advanceDate, cashflowToOutflow, cashflowToRecurring, outflowToCashflow, recurringToCashflow, type CashflowItemRow } from './plannedItems'
import { selectCashflows, type CashflowRow } from './projection/inputs'

const row = (over: Partial<CashflowItemRow>): CashflowItemRow => ({
  id: 'x', description: 'Item', kind: 'expense', person_key: null, amount_cents: -50_000, currency: 'AUD', frequency: 'once',
  start_date: '2027-02-01', status: 'planned', category_id: null, account_id: null, notes: null, source_table: null, ...over,
})

describe('Goals › Upcoming payments ↔ planned_cashflows', () => {
  it('maps a one-off expense, recovering a category kept in the notes by the backfill', () => {
    expect(cashflowToOutflow(row({ notes: 'Deposit for venue · category: Wedding', source_table: 'planned_outflows' }), () => undefined)).toEqual({
      id: 'x', description: 'Item', amount_cents: 50_000, due_date: '2027-02-01', status: 'planned', category: 'Wedding', notes: 'Deposit for venue',
    })
    expect(cashflowToOutflow(row({ category_id: 'c1' }), id => (id === 'c1' ? 'Travel' : undefined)).category).toBe('Travel')
  })
  it('writes negative AUD one-offs; unknown category names go in the notes', () => {
    expect(outflowToCashflow({ description: ' Flights ', amount_cents: 120_000, due_date: '2027-05-01', category: 'Travel', notes: '' }, null)).toEqual({
      description: 'Flights', kind: 'expense', amount_cents: -120_000, currency: 'AUD', frequency: 'once', start_date: '2027-05-01',
      category_id: null, account_id: null, notes: 'category: Travel',
    })
    expect(outflowToCashflow({ description: 'Flights', amount_cents: 120_000, due_date: '2027-05-01', category: 'Travel' }, 'c-travel').notes).toBeNull()
  })
})

describe('Settings › Recurring ↔ planned_cashflows', () => {
  it('maps signed amounts, owner and the "already in spending" flag', () => {
    const r = cashflowToRecurring(row({ frequency: 'monthly', start_date: '2026-12-15', source_table: 'recurring_transactions', person_key: 'evan', amount_cents: -1_999 }))!
    expect(r).toMatchObject({ amount_cents: -1_999, owner: 'evan', recurrence: 'monthly', next_due: '2026-12-15', day_of_month: 15, is_active: true, in_spending: true })
    expect(cashflowToRecurring(row({ frequency: 'once' }))).toBeNull()
    expect(cashflowToRecurring(row({ frequency: 'annual', kind: 'income', amount_cents: 500_000 }))!.amount_cents).toBe(500_000)
    expect(cashflowToRecurring(row({ frequency: 'weekly' }))!.in_spending).toBe(false)
  })
  it('writes rows the projection skips (in spending) or includes (new)', () => {
    const base = { description: 'Gym', amount_cents: -6_000, currency: 'AUD', category_id: null, account_id: 'joint', owner: 'joint' as const, recurrence: 'monthly' as const, next_due: '2027-01-05', is_active: true, notes: null }
    const inSpend = recurringToCashflow({ ...base, in_spending: true })
    expect(inSpend).toMatchObject({ kind: 'expense', person_key: null, frequency: 'monthly', start_date: '2027-01-05', status: 'planned', source_table: 'settings_recurring', is_gross: false })
    expect(recurringToCashflow({ ...base, in_spending: true }, 'recurring_transactions').source_table).toBe('recurring_transactions')
    const fresh = recurringToCashflow({ ...base, in_spending: false })
    expect(fresh.source_table).toBeNull()
    expect(recurringToCashflow({ ...base, is_active: false, in_spending: false }).status).toBe('cancelled')

    // …and the projection agrees
    const toRow = (id: string, f: ReturnType<typeof recurringToCashflow>): CashflowRow => ({
      id, description: f.description, kind: f.kind, person_key: f.person_key, amount_cents: f.amount_cents, currency: f.currency, is_gross: false,
      frequency: f.frequency, start_date: f.start_date, end_date: null, indexation: 'none', indexation_pct: null, account_id: f.account_id,
      to_account_id: null, event_id: null, status: f.status, source_table: f.source_table, scenario_id: null,
    })
    const sel = selectCashflows([toRow('a', inSpend), toRow('b', fresh)], { today: '2026-11-13', scenarioId: null })
    expect(sel.cashflows.map(c => c.id)).toEqual(['b'])
    expect(sel.skipped.map(s => s.id)).toEqual(['a'])
  })
  it('advances the next due date, clamping month ends', () => {
    expect(advanceDate('2026-12-31', 'weekly')).toBe('2027-01-07')
    expect(advanceDate('2026-12-25', 'fortnightly')).toBe('2027-01-08')
    expect(advanceDate('2027-01-31', 'monthly')).toBe('2027-02-28')
    expect(advanceDate('2028-01-31', 'monthly')).toBe('2028-02-29')
    expect(advanceDate('2026-11-30', 'quarterly')).toBe('2027-02-28')
    expect(advanceDate('2028-02-29', 'annual')).toBe('2029-02-28')
  })
})

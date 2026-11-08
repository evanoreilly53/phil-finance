import { describe, it, expect } from 'vitest'
import { occurrencesInMonth, monthDiff, addMonthsKey, monthEnd, daysInMonth } from './schedule'
import { spendingBaseline, selectCashflows, houseParams, chooseSweepAccount, defaultDepositAccountIds, depositAccountIdsFromParams, type CashflowRow } from './inputs'
import { solveGoal, hitMonth } from './goals'
import { runProjection } from './engine'
import { $, account, baseInput, spending } from './fixtures'

describe('schedule', () => {
  it('month arithmetic and month ends (leap years too)', () => {
    expect(addMonthsKey('2026-12', 1)).toBe('2027-01')
    expect(addMonthsKey('2027-01', -1)).toBe('2026-12')
    expect(addMonthsKey('2026-12', 359)).toBe('2056-11')
    expect(monthDiff('2026-12', '2028-03')).toBe(15)
    expect(monthEnd('2028-02')).toBe('2028-02-29')
    expect(monthEnd('2027-02')).toBe('2027-02-28')
    expect(daysInMonth('2027-04')).toBe(30)
  })
  it('once', () => {
    const it1 = { frequency: 'once' as const, startDate: '2027-03-31', endDate: null }
    expect(occurrencesInMonth(it1, '2027-03')).toEqual(['2027-03-31'])
    expect(occurrencesInMonth(it1, '2027-04')).toEqual([])
  })
  it('monthly on the 31st clamps to month end', () => {
    const it1 = { frequency: 'monthly' as const, startDate: '2027-01-31', endDate: null }
    expect(occurrencesInMonth(it1, '2027-02')).toEqual(['2027-02-28'])
    expect(occurrencesInMonth(it1, '2028-02')).toEqual(['2028-02-29'])
    expect(occurrencesInMonth(it1, '2027-04')).toEqual(['2027-04-30'])
    expect(occurrencesInMonth(it1, '2026-12')).toEqual([])
  })
  it('quarterly and annual keep their cadence; end date stops them', () => {
    const q = { frequency: 'quarterly' as const, startDate: '2027-01-15', endDate: '2027-07-14' }
    expect(occurrencesInMonth(q, '2027-04')).toEqual(['2027-04-15'])
    expect(occurrencesInMonth(q, '2027-05')).toEqual([])
    expect(occurrencesInMonth(q, '2027-07')).toEqual([])
    const y = { frequency: 'annual' as const, startDate: '2024-02-29', endDate: null }
    expect(occurrencesInMonth(y, '2027-02')).toEqual(['2027-02-28'])
  })
  it('weekly: 4 or 5 per month', () => {
    const w = { frequency: 'weekly' as const, startDate: '2026-12-03', endDate: null }
    expect(occurrencesInMonth(w, '2026-12')).toHaveLength(5)
    expect(occurrencesInMonth(w, '2027-02')).toHaveLength(4)
    expect(occurrencesInMonth({ ...w, endDate: '2026-12-15' }, '2026-12')).toEqual(['2026-12-03', '2026-12-10'])
  })
})

describe('spending baseline', () => {
  const categories = [
    { id: 'housing', name: 'Housing/Utilities', parent_id: null, kind: 'essential' as const },
    { id: 'rent', name: 'Rent', parent_id: 'housing', kind: 'essential' as const },
    { id: 'eat', name: 'Eating out', parent_id: null, kind: 'discretionary' as const },
    { id: 'wed', name: 'Wedding', parent_id: null, kind: 'discretionary' as const },
    { id: 'stocks', name: 'Stocks', parent_id: null, kind: 'savings' as const },
    { id: 'salary', name: 'Salary', parent_id: null, kind: 'income' as const },
  ]
  const tx = (date: string, dollars: number, category_id: string | null, is_transfer = false) => ({ date, aud_amount_cents: $(dollars), category_id, is_transfer })
  const txs = [
    tx('2026-08-03', -2_400, 'rent'), tx('2026-09-03', -2_400, 'rent'), tx('2026-10-03', -2_400, 'rent'),
    tx('2026-08-10', -300, 'eat'), tx('2026-10-10', -600, 'eat'), tx('2026-10-12', 60, 'eat'), // refund
    tx('2026-09-01', -20_000, 'wed'),
    tx('2026-09-02', -5_000, 'stocks'),
    tx('2026-09-15', 6_000, 'salary'),
    tx('2026-09-20', -10_000, null, true), // transfer
    tx('2026-10-20', -90, null),
    tx('2026-11-02', -999, 'eat'), // current month: not averaged
  ]
  const b = spendingBaseline({
    txs, categories, budgets: [{ category_id: 'eat', monthly_cents: $(250), effective_from: '2026-11-01' }],
    months: ['2026-08', '2026-09', '2026-10'], budgetMonth: '2026-11', excludeRootIds: new Set(['wed']),
  })
  const line = (k: string) => b.lines.find(l => l.key === k)

  it('averages complete months, rolls children up, excludes transfers/income/savings', () => {
    expect(line('housing')).toMatchObject({ monthlyCents: $(2_400), basis: 'average' })
    expect(line('uncategorised')).toMatchObject({ monthlyCents: $(30), basis: 'average', name: 'Uncategorised' })
    expect(line('stocks')).toBeUndefined()
    expect(line('salary')).toBeUndefined()
  })
  it('uses the budget target where one is set', () => {
    expect(line('eat')).toMatchObject({ averageCents: $(280), budgetCents: $(250), monthlyCents: $(250), basis: 'budget' })
  })
  it('leaves out excluded events (wedding)', () => {
    expect(line('wed')).toMatchObject({ monthlyCents: 0, averageCents: Math.round($(20_000) / 3), basis: 'excluded' })
  })
  it('total is what the projection uses', () => {
    expect(b.totalMonthlyCents).toBe($(2_400) + $(250) + $(30))
  })
})

describe('selectCashflows', () => {
  const row = (over: Partial<CashflowRow>): CashflowRow => ({
    id: 'x', description: 'Item', kind: 'expense', person_key: null, amount_cents: -$(100), currency: 'AUD', is_gross: false,
    frequency: 'once', start_date: '2027-01-01', end_date: null, indexation: 'none', indexation_pct: null,
    account_id: null, to_account_id: null, event_id: null, status: 'planned', source_table: null, scenario_id: null, ...over,
  })
  const r = selectCashflows([
    row({ id: 'sal', kind: 'income', is_gross: true, person_key: 'rachel', amount_cents: $(105_000), frequency: 'annual', indexation: 'wages' }),
    row({ id: 'salF', kind: 'income', is_gross: true, person_key: 'evan', amount_cents: $(3_500), frequency: 'fortnightly' }),
    row({ id: 'nobody', kind: 'income', is_gross: true, amount_cents: $(1_000), frequency: 'monthly' }),
    row({ id: 'netflix', frequency: 'monthly', source_table: 'recurring_transactions' }),
    row({ id: 'wedEur', frequency: 'once', source_table: 'wedding_items', currency: 'EUR', start_date: '2026-12-01' }),
    row({ id: 'old', start_date: '2026-07-01', source_table: 'planned_outflows' }),
    row({ id: 'paid', status: 'paid' }),
    row({ id: 'otherScenario', scenario_id: 's2' }),
    row({ id: 'mine', scenario_id: 's1' }),
    row({ id: 'cancelledEvent', event_id: 'e-x' }),
    row({ id: 'ended', frequency: 'monthly', start_date: '2025-01-01', end_date: '2026-10-31' }),
  ], { today: '2026-11-08', scenarioId: 's1', cancelledEventIds: new Set(['e-x']) })

  it('gross income rows become annual salaries', () => {
    expect(r.salaries.map(s => [s.id, s.grossAnnualCents])).toEqual([['sal', $(105_000)], ['salF', $(91_000)]])
  })
  it('skips with a reason: no person, recurring copies, overdue one-offs', () => {
    expect(r.skipped.map(s => s.id)).toEqual(['nobody', 'netflix', 'old'])
    expect(r.skipped[2].reason).toMatch(/not marked paid/)
  })
  it('keeps one-offs, the selected scenario and shared rows', () => {
    expect(r.cashflows.map(c => c.id)).toEqual(['wedEur', 'mine'])
  })
})

describe('house params + account choices', () => {
  it('reads the life_events params, with a placeholder for duty + costs', () => {
    expect(houseParams({ price_cents: $(1_000_000), deposit_cents: $(250_000), loan_term_months: 360 }, null)).toEqual({
      priceCents: $(1_000_000), upfrontCents: $(250_000), costsCents: $(45_000), costsIsPlaceholder: true, loanTermMonths: 360, rentMonthlyCents: 0,
    })
    expect(houseParams({ price_cents: '85000000', upfront_costs_cents: 0, rent_monthly_cents: $(2_600) }, $(100_000))).toMatchObject({
      priceCents: $(850_000), upfrontCents: $(100_000), costsCents: 0, costsIsPlaceholder: false, rentMonthlyCents: $(2_600),
    })
    expect(houseParams({}, null)).toBeNull()
    expect(houseParams(null, null)).toBeNull()
  })
  it('deposit account list from params', () => {
    expect(depositAccountIdsFromParams({ deposit_account_ids: ['a', 3, 'b'] })).toEqual(['a', 'b'])
    expect(depositAccountIdsFromParams({})).toBeNull()
  })
  it('sweep: joint everyday AUD account with the most money; never the wedding or EUR account', () => {
    const accts = [
      account('rachel', 'bank', 40_000, { owner: 'rachel' }),
      account('joint-small', 'bank', 2_000),
      account('joint-big', 'savings', 30_000),
      account('wedding', 'wedding', 90_000),
      account('aib', 'bank', 99_000, { currency: 'EUR' }),
    ]
    expect(chooseSweepAccount(accts)).toBe('joint-big')
    expect(chooseSweepAccount([])).toBeNull()
  })
  it('default deposit pot: cash + investments, not equity stakes or super', () => {
    const accts = [account('joint', 'bank', 1), account('etf', 'investment', 1), account('biz', 'investment', 1, { name: 'Business Venture' }), account('s', 'super', 1)]
    expect(defaultDepositAccountIds(accts)).toEqual(['joint', 'etf'])
  })
})

describe('goals', () => {
  const input = baseInput({ months: 60, spending: spending(0), cashflows: [], accounts: [account('joint', 'bank', 100_000)], netIncomes: [{ personKey: null, label: 'Household', monthlyNetCents: $(5_000), source: 'test' }] })

  it('hit month: first month at or above target', () => {
    const p = runProjection(input)
    // $100k + $5k/mo from Dec-26: $150k after 10 months → Sep 2027
    expect(hitMonth(p, 'depositPotCents', $(150_000))).toBe('2027-09')
    expect(hitMonth(p, 'depositPotCents', $(50_000))).toBe('now')
    expect(hitMonth(p, 'depositPotCents', $(10_000_000))).toBeNull()
  })

  it('on track → no extra needed, months early is negative', () => {
    const s = solveGoal(input, 'depositPotCents', $(150_000), '2027-12')
    expect(s.extraMonthlyCents).toBe(0)
    expect(s.projectedMonth).toBe('2027-09')
    expect(s.monthsLate).toBe(-3)
    expect(s.currentMonthlyPaceCents).toBe($(5_000))
  })

  it('behind → back-solves the extra per month (rounded up to $10)', () => {
    // Need $250k by Mar 2028 (16 months): on plan $180k, gap $70k → $4,375/mo
    const s = solveGoal(input, 'depositPotCents', $(250_000), '2028-03')
    expect(s.valueAtByMonth).toBe($(180_000))
    expect(s.projectedMonth).toBe('2029-05')
    expect(s.monthsLate).toBe(14)
    expect(s.extraMonthlyCents).toBe($(4_380))
    const check = runProjection({ ...input, extraMonthlyCents: s.extraMonthlyCents! })
    expect(check.months.find(m => m.month === '2028-03')!.depositPotCents).toBeGreaterThanOrEqual($(250_000))
  })

  it('target date already passed → no back-solve', () => {
    expect(solveGoal(input, 'depositPotCents', $(250_000), '2026-10').extraMonthlyCents).toBeNull()
  })
})

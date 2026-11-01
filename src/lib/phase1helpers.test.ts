import { describe, it, expect } from 'vitest'
import { budgetsForMonth, spendByCategory, budgetProgress, rootCategoryId, UNCATEGORISED } from './budgets'
import { freshness, agoLabel, worstFirst } from './freshness'
import { parseFrankfurter, needsRefresh, chooseRate } from './fx'
import { resolveAssumptions, ASSUMPTIONS } from './assumptions'
import { suggestRulePattern, reviewReasons } from './review'
import { dayDiff, addDays, perthToday } from './import/dates'

describe('budgets', () => {
  const budgets = [
    { category_id: 'food', monthly_cents: 80000, effective_from: '2026-01-01' },
    { category_id: 'food', monthly_cents: 90000, effective_from: '2026-11-01' },
    { category_id: 'fun', monthly_cents: 20000, effective_from: '2026-12-01' },
  ]
  it('picks the target in force for the month', () => {
    expect(budgetsForMonth(budgets, '2026-10')).toEqual(new Map([['food', 80000]]))
    expect(budgetsForMonth(budgets, '2026-12')).toEqual(new Map([['food', 90000], ['fun', 20000]]))
  })

  const cats = [
    { id: 'housing', parent_id: null, kind: 'essential' as const },
    { id: 'rent', parent_id: 'housing', kind: 'essential' as const },
    { id: 'food', parent_id: null, kind: 'essential' as const },
    { id: 'salary', parent_id: null, kind: 'income' as const },
  ]
  const txs = [
    { date: '2026-10-01', aud_amount_cents: -260000, category_id: 'rent' },
    { date: '2026-10-03', aud_amount_cents: -5000, category_id: 'food' },
    { date: '2026-10-04', aud_amount_cents: 1000, category_id: 'food' },               // refund
    { date: '2026-10-05', aud_amount_cents: -100000, category_id: null, is_transfer: true },
    { date: '2026-10-06', aud_amount_cents: -700, category_id: null },
    { date: '2026-10-07', aud_amount_cents: 500000, category_id: 'salary' },
    { date: '2026-10-08', aud_amount_cents: 300, category_id: null },                   // unplaced money in
    { date: '2026-11-01', aud_amount_cents: -999, category_id: 'food' },
  ]
  it('excludes transfers and income, nets refunds, and rolls up', () => {
    expect(spendByCategory(txs, '2026-10', cats, { rollup: true })).toEqual(new Map([
      ['housing', 260000], ['food', 4000], [UNCATEGORISED, 700],
    ]))
    expect(spendByCategory(txs, '2026-10', cats).get('rent')).toBe(260000)
  })
  it('finds roots safely even with a cycle', () => {
    const byId = new Map([['a', { id: 'a', parent_id: 'b' }], ['b', { id: 'b', parent_id: 'a' }]])
    expect(['a', 'b']).toContain(rootCategoryId('a', byId))
  })
  it('reports progress', () => {
    expect(budgetProgress(50, 100)).toEqual({ pct: 0.5, remainingCents: 50, status: 'under' })
    expect(budgetProgress(90, 100).status).toBe('near')
    expect(budgetProgress(120, 100)).toMatchObject({ status: 'over', remainingCents: -20 })
    expect(budgetProgress(0, 0).status).toBe('under')
  })
})

describe('freshness', () => {
  it('uses tighter limits for everyday accounts', () => {
    expect(freshness('2026-10-29', '2026-11-01', 'bank')).toEqual({ status: 'fresh', days: 3 })
    expect(freshness('2026-10-10', '2026-11-01', 'bank').status).toBe('ageing')
    expect(freshness('2026-09-01', '2026-11-01', 'bank').status).toBe('stale')
    expect(freshness('2026-10-10', '2026-11-01', 'super').status).toBe('fresh')
    expect(freshness(null, '2026-11-01', 'bank')).toEqual({ status: 'never', days: null })
  })
  it('labels and sorts', () => {
    expect([agoLabel(0), agoLabel(1), agoLabel(5), agoLabel(null)]).toEqual(['today', 'yesterday', '5 days ago', 'never'])
    expect(worstFirst([{ status: 'fresh' as const }, { status: 'never' as const }, { status: 'stale' as const }]).map(x => x.status))
      .toEqual(['never', 'stale', 'fresh'])
  })
})

describe('fx', () => {
  it('parses the v1 shape and inverts to AUD per unit', () => {
    expect(parseFrankfurter({ amount: 1, base: 'AUD', date: '2026-10-30', rates: { EUR: 0.625, GBP: 0.5 } }))
      .toEqual({ date: '2026-10-30', audPer: { EUR: 1.6, GBP: 2 } })
  })
  it('parses the v2 shape', () => {
    expect(parseFrankfurter([{ date: '2026-11-01', base: 'AUD', quote: 'EUR', rate: 0.625 }]))
      .toEqual({ date: '2026-11-01', audPer: { EUR: 1.6 } })
  })
  it('rejects junk, wrong base and non-positive rates', () => {
    expect(parseFrankfurter(null)).toBeNull()
    expect(parseFrankfurter({ base: 'EUR', date: '2026-10-30', rates: { AUD: 1.6 } })).toBeNull()
    expect(parseFrankfurter({ base: 'AUD', date: '2026-10-30', rates: { EUR: 0 } })).toBeNull()
    expect(parseFrankfurter('<html>')).toBeNull()
  })
  it('refreshes at most every 12 hours', () => {
    const now = new Date('2026-11-01T12:00:00Z')
    expect(needsRefresh(null, now)).toBe(true)
    expect(needsRefresh('2026-11-01T06:00:00Z', now)).toBe(false)
    expect(needsRefresh('2026-10-31T20:00:00Z', now)).toBe(true)
    expect(needsRefresh('garbage', now)).toBe(true)
  })
  it('falls back safely', () => {
    expect(chooseRate('EUR', { rate: '1.6123', date: '2026-10-30' })).toEqual({ rate: 1.6123, date: '2026-10-30', source: 'stored' })
    expect(chooseRate('EUR', null)).toEqual({ rate: 1.65, date: null, source: 'fallback' })
    expect(chooseRate('JPY', null)).toBeNull()
  })
})

describe('assumptions', () => {
  const scenarios = [
    { id: 'base', parent_scenario_id: null },
    { id: 'early', parent_scenario_id: 'base' },
    { id: 'rates', parent_scenario_id: 'early' },
  ]
  const rows = [
    { scenario_id: 'base', key: 'inflation_pct', value: '2.5' },
    { scenario_id: 'base', key: 'mortgage_rate_pct', value: 6 },
    { scenario_id: 'rates', key: 'mortgage_rate_pct', value: 7 },
    { scenario_id: 'base', key: 'not_a_key', value: 1 },
  ]
  it('resolves own → inherited → default', () => {
    const r = resolveAssumptions('rates', scenarios, rows)
    expect(r.mortgage_rate_pct).toEqual({ value: 7, source: 'scenario', scenarioId: 'rates' })
    expect(r.inflation_pct).toEqual({ value: 2.5, source: 'inherited', scenarioId: 'base' })
    expect(r.wage_growth_pct).toEqual({ value: ASSUMPTIONS.wage_growth_pct.default, source: 'default', scenarioId: null })
    expect(Object.keys(r)).not.toContain('not_a_key')
  })
  it('survives a parent cycle', () => {
    const r = resolveAssumptions('a', [{ id: 'a', parent_scenario_id: 'b' }, { id: 'b', parent_scenario_id: 'a' }], [])
    expect(r.inflation_pct.source).toBe('default')
  })
})

describe('review', () => {
  it('suggests a merchant pattern', () => {
    expect(suggestRulePattern('WOOLWORTHS 1234 PERTH AU Card xx1234 Value Date: 27/10/2026')).toBe('WOOLWORTHS')
    expect(suggestRulePattern('SQ *CAFE NERO PERTH')).toBe('CAFE\\s+NERO')
    expect(suggestRulePattern('1234 5678')).toBeNull()
    const p = suggestRulePattern('Uber *Trip Help.uber.com')!
    expect(new RegExp(p, 'i').test('UBER TRIP SYDNEY')).toBe(true)
  })
  it('lists reasons, computing uncategorised', () => {
    expect(reviewReasons({ review_flags: [], category_id: null, is_transfer: false })).toEqual(['uncategorised'])
    expect(reviewReasons({ review_flags: [], category_id: null, is_transfer: true })).toEqual([])
    expect(reviewReasons({ review_flags: ['suspected_transfer'], category_id: null, is_transfer: false })).toEqual(['suspected_transfer'])
    expect(reviewReasons({ review_flags: ['suspected_duplicate'], category_id: 'c', is_transfer: false })).toEqual(['suspected_duplicate'])
  })
})

describe('dates', () => {
  it('does calendar maths across months and years', () => {
    expect(dayDiff('2026-02-27', '2026-03-02')).toBe(3)
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(perthToday(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11-01')
  })
})

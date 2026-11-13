import { describe, it, expect } from 'vitest'
import { validateAssumptionValues } from './assumptions'
import { monthSummary, netWorthChange } from './checkin'
import { mergeHouseParams, validateHouseEdit, houseParams, type HouseEdit } from './projection/inputs'
import { chartSeries, ledgerGroups, previousTotals } from './projection/present'
import { runProjection } from './projection/engine'
import { $, account, baseInput, spending } from './projection/fixtures'

describe('validateAssumptionValues', () => {
  it('keeps valid keys, drops blanks/unknown, flags bad values', () => {
    const r = validateAssumptionValues({ inflation_pct: '2.5', wage_growth_pct: '', bogus: '9', cash_return_pct: 'abc', super_return_pct: '99', fx_eur_aud: 1.7 })
    expect(r.values).toEqual({ inflation_pct: 2.5, fx_eur_aud: 1.7 })
    expect(r.errors).toEqual({ cash_return_pct: 'Enter a number', super_return_pct: 'Between -20 and 25' })
  })
})

describe('house edits', () => {
  const edit: HouseEdit = { priceCents: $(950_000), upfrontCents: $(240_000), costsCents: null, rentMonthlyCents: $(2_600), loanTermMonths: 300, depositAccountIds: ['a'] }
  it('merge keeps keys the form does not own and round-trips through houseParams', () => {
    const merged = mergeHouseParams({ state: 'WA', first_home_buyer: true, upfront_costs_cents: 123 }, edit)
    expect(merged).toMatchObject({ state: 'WA', first_home_buyer: true, price_cents: $(950_000), deposit_cents: $(240_000), loan_term_months: 300, deposit_account_ids: ['a'] })
    expect('upfront_costs_cents' in merged).toBe(false)
    expect(houseParams(merged, null)).toMatchObject({ priceCents: $(950_000), upfrontCents: $(240_000), costsSource: 'calculated', rentMonthlyCents: $(2_600), loanTermMonths: 300, firstHome: true })
  })
  it('validation', () => {
    expect(validateHouseEdit(edit)).toBeNull()
    expect(validateHouseEdit({ ...edit, priceCents: 0 })).toMatch(/price/)
    expect(validateHouseEdit({ ...edit, upfrontCents: $(2_000_000) })).toMatch(/more than the price/)
    expect(validateHouseEdit({ ...edit, costsCents: $(300_000) })).toMatch(/part of the upfront/)
    expect(validateHouseEdit({ ...edit, loanTermMonths: 6 })).toMatch(/1–50 years/)
  })
})

describe('home check-in', () => {
  const cats = [{ id: 'food', parent_id: null, kind: 'essential' as const }, { id: 'pay', parent_id: null, kind: 'income' as const }]
  const tx = (date: string, d: number, category_id: string | null, is_transfer = false) => ({ date, aud_amount_cents: $(d), category_id, is_transfer })
  it('spend vs budget and saved, transfers excluded', () => {
    const s = monthSummary([
      tx('2026-11-01', 6_000, 'pay'), tx('2026-11-02', 500, null), tx('2026-11-03', -1_200, 'food'), tx('2026-11-04', 50, 'food'),
      tx('2026-11-05', -3_000, null, true), tx('2026-10-31', -999, 'food'),
    ], cats, [{ category_id: 'food', monthly_cents: $(1_500), effective_from: '2026-09-01' }], '2026-11')
    expect(s).toEqual({ spentCents: $(1_150), budgetCents: $(1_500), incomeCents: $(6_500), savedCents: $(5_350), savedPct: 5_350 / 6_500 })
  })
  it('no income → no savings rate', () => {
    expect(monthSummary([], cats, [], '2026-11').savedPct).toBeNull()
  })
  it('net worth change on the month', () => {
    expect(netWorthChange([{ mk: '2026-09', cents: 100 }, { mk: '2026-10', cents: 160 }])).toEqual({ mk: '2026-10', cents: 160, changeCents: 60 })
    expect(netWorthChange([{ mk: '2026-10', cents: 160 }])?.changeCents).toBeNull()
    expect(netWorthChange([])).toBeNull()
  })
})

describe('projection presentation', () => {
  const p = runProjection(baseInput({
    months: 3, spending: spending(1_000),
    accounts: [account('joint', 'bank', 10_000), account('etf', 'investment', 0)],
    cashflows: [{ id: 't', description: 'To ETF', kind: 'transfer', personKey: null, amountCents: $(500), currency: 'AUD', frequency: 'monthly', startDate: '2026-12-01', endDate: null, indexation: 'none', indexationPct: null, accountId: null, toAccountId: 'etf', eventId: null }],
  }))
  it('chart starts with "Now" then one point per month, in dollars', () => {
    const s = chartSeries(p)
    expect(s.map(x => x.month)).toEqual(['now', '2026-12', '2027-01', '2027-02'])
    expect(s[0].netWorth).toBe(10_000)
    expect(s[1].netWorth).toBe(9_000)
    expect(s[1].liquid).toBe(8_500)
  })
  it('ledger groups show each internal move once', () => {
    const g = ledgerGroups(p.months[0])
    expect(g.map(x => x.key)).toEqual(['spending', 'planned'])
    expect(g[1].entries).toHaveLength(1)
    expect(g[1].nwCents).toBe(0)
    expect(g[0].nwCents).toBe(-$(1_000))
  })
  it('previous totals: opening for month one', () => {
    expect(previousTotals(p, '2026-12')).toBe(p.opening)
    expect(previousTotals(p, '2027-01')).toBe(p.months[0])
    expect(previousTotals(p, '2030-01')).toBeNull()
  })
})

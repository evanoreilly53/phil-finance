import { describe, it, expect } from 'vitest'
import { scenarioChain, selectScenarioEvents, summariseScenario, diffAssumptions, diffHouse, exampleScenarios } from './scenarios'
import { buildPlan, depositGoal, type PlanData } from './plan'
import { resolveAssumptions } from '../assumptions'
import { houseParams } from './inputs'
import { $ } from './fixtures'

const scenarios = [
  { id: 'base', name: 'Baseline', is_baseline: true, parent_scenario_id: null },
  { id: 'early', name: '$850k early', is_baseline: false, parent_scenario_id: 'base' },
  { id: 'early-hi', name: '$850k early, rates +1', is_baseline: false, parent_scenario_id: 'early' },
  { id: 'leave', name: 'One income', is_baseline: false, parent_scenario_id: 'base' },
]

describe('scenario chain + which events a scenario sees', () => {
  it('walks to the root, nearest first', () => {
    expect(scenarioChain('early-hi', scenarios)).toEqual(['early-hi', 'early', 'base'])
    expect(scenarioChain('base', scenarios)).toEqual(['base'])
    expect(scenarioChain('nope', scenarios)).toEqual([])
    expect(scenarioChain('a', [{ id: 'a', parent_scenario_id: 'b' }, { id: 'b', parent_scenario_id: 'a' }])).toEqual(['a', 'b'])
  })
  const events = [
    { id: 'shared-house', scenario_id: null, kind: 'house_purchase', status: 'planned' },
    { id: 'wedding', scenario_id: null, kind: 'wedding', status: 'done' },
    { id: 'early-house', scenario_id: 'early', kind: 'house_purchase', status: 'planned' },
    { id: 'leave-ev', scenario_id: 'leave', kind: 'leave', status: 'planned' },
  ]
  it('a scenario house replaces the shared one; children inherit it', () => {
    expect(selectScenarioEvents(events, ['base']).map(e => e.id)).toEqual(['shared-house', 'wedding'])
    expect(selectScenarioEvents(events, ['early', 'base']).map(e => e.id)).toEqual(['wedding', 'early-house'])
    expect(selectScenarioEvents(events, ['early-hi', 'early', 'base']).map(e => e.id)).toEqual(['wedding', 'early-house'])
    expect(selectScenarioEvents(events, ['leave', 'base']).map(e => e.id)).toEqual(['shared-house', 'wedding', 'leave-ev'])
  })
  it('a cancelled scenario house doesn’t hide the shared one', () => {
    const ev = [...events.slice(0, 2), { id: 'x', scenario_id: 'leave', kind: 'house_purchase', status: 'cancelled' }]
    expect(selectScenarioEvents(ev, ['leave', 'base']).map(e => e.id)).toEqual(['shared-house', 'wedding', 'x'])
  })
})

// A small household plan, as fetchPlanData would return it.
function data(over: Partial<PlanData> = {}): PlanData {
  const salary = (id: string, person: string, gross: number) => ({
    id, description: `${person} salary`, kind: 'income' as const, person_key: person, amount_cents: $(gross), currency: 'AUD', is_gross: true,
    frequency: 'annual' as const, start_date: '2026-07-01', end_date: null, indexation: 'none' as const, indexation_pct: null,
    account_id: null, to_account_id: null, event_id: null, status: 'planned' as const, source_table: null, scenario_id: null,
  })
  return {
    today: '2026-11-13',
    thisMonth: '2026-11',
    accounts: [{
      id: 'joint', name: 'Joint', type: 'bank', owner: 'joint', currency: 'AUD', is_liquid: true, interest_rate_pct: null, expected_return_pct: null,
      fee_pct: null, annual_fee_cents: null, loan_original_cents: null, loan_start_date: null, loan_term_months: null, loan_repayment_cents: null,
      loan_repayment_freq: null, loan_interest_only: false, offset_account_id: null,
    }],
    snapshots: [{ account_id: 'joint', aud_balance_cents: $(150_000), date: '2026-11-01' }],
    people: [
      { key: 'rachel', display_name: 'Rachel', has_private_hospital: true, has_hecs: false },
      { key: 'evan', display_name: 'Evan', has_private_hospital: true, has_hecs: false },
    ],
    scenarios,
    assumptionRows: [
      { scenario_id: 'base', key: 'inflation_pct', value: 0 }, { scenario_id: 'base', key: 'wage_growth_pct', value: 0 },
      { scenario_id: 'base', key: 'cash_return_pct', value: 0 }, { scenario_id: 'base', key: 'house_price_growth_pct', value: 0 },
      { scenario_id: 'base', key: 'mortgage_rate_pct', value: 6 },
      { scenario_id: 'early-hi', key: 'mortgage_rate_pct', value: 7 },
      { scenario_id: 'leave', key: 'extra_saving_monthly', value: 250 },
    ],
    events: [
      { id: 'shared-house', scenario_id: null, name: 'Buy our first home', kind: 'house_purchase', event_date: '2028-03-01', end_date: null, status: 'planned', budget_cents: $(250_000), params: { price_cents: $(1_000_000), deposit_cents: $(250_000), first_home_buyer: true } },
      { id: 'early-house', scenario_id: 'early', name: 'Buy at $850k', kind: 'house_purchase', event_date: '2027-09-01', end_date: null, status: 'planned', budget_cents: $(85_000), params: { price_cents: $(850_000), deposit_cents: $(85_000), first_home_buyer: true, use_deposit_scheme: true } },
      { id: 'leave-ev', scenario_id: 'leave', name: 'Evan on leave', kind: 'leave', event_date: '2028-04-01', end_date: '2029-03-31', status: 'planned', budget_cents: null, params: { person_key: 'evan', pay_pct: 0 } },
    ],
    cashflowRows: [salary('s-r', 'rachel', 105_000), salary('s-e', 'evan', 90_000)],
    spending: { lines: [], totalMonthlyCents: $(5_000), months: [] },
    fxRows: [],
    members: [],
    ...over,
  }
}

describe('buildPlan per scenario', () => {
  it('baseline: shared house with the WA calculator costs', () => {
    const p = buildPlan(data())
    expect(p.scenario?.id).toBe('base')
    expect(p.house?.id).toBe('shared-house')
    expect(p.house?.house.costsCents).toBe($(46_105.70))
    expect(p.input.extraMonthlyCents).toBe(0)
  })
  it('fork: its own house, inherited rates; grandchild overrides the rate', () => {
    const early = buildPlan(data(), { scenarioId: 'early' })
    expect(early.house?.id).toBe('early-house')
    expect(early.house?.house.useScheme).toBe(true)
    expect(early.input.assumptions.mortgage_rate_pct).toBe(6)
    const hi = buildPlan(data(), { scenarioId: 'early-hi' })
    expect(hi.house?.id).toBe('early-house')
    expect(hi.input.assumptions.mortgage_rate_pct).toBe(7)
  })
  it('leave + extra saving scenario', () => {
    const p = buildPlan(data(), { scenarioId: 'leave' })
    expect(p.leaves).toEqual([{ id: 'leave-ev', scenarioId: 'leave', name: 'Evan on leave', date: '2028-04-01', endDate: '2029-03-31', personKey: 'evan', payPct: 0 }])
    expect(p.input.extraMonthlyCents).toBe($(250))
    expect(p.input.events.find(e => e.id === 'leave-ev')?.leave?.personKey).toBe('evan')
  })
  it('unknown scenario falls back to the baseline', () => {
    expect(buildPlan(data(), { scenarioId: 'gone' }).scenario?.id).toBe('base')
  })
})

describe('side-by-side summaries', () => {
  const base = buildPlan(data())
  const early = buildPlan(data(), { scenarioId: 'early' })
  const leave = buildPlan(data(), { scenarioId: 'leave' })
  const sum = (p: typeof base) => summariseScenario(p.input, p.house ? { date: p.house.date, params: p.house.house } : null, '2030-12')

  it('baseline $1M Mar-28: loan, repayment, deposit date', () => {
    const s = sum(base)
    expect(s.houseMonth).toBe('2028-03')
    // $250k cash − $46,105.70 costs = $203,894.30 deposit → loan $796,105.70
    expect(s.loanCents).toBe($(796_105.70))
    expect(s.monthlyRepaymentCents! / 100).toBeCloseTo(4_773, 0)
    // $150k now + $7,630/mo surplus ($12,630 take-home − $5,000) from Dec 2026 → $250k after 14 months (Jan 2028)
    expect(s.depositReadyMonth).toBe('2028-01')
    expect(s.depositMonthsLate).toBe(-2)
    expect(s.interestToAtCents).toBeGreaterThan(0)
    expect(s.atMonth).toBe('2030-12')
  })
  it('the $850k 5% scheme scenario borrows more, sooner, with no LMI', () => {
    const s = sum(early)
    expect(s.houseMonth).toBe('2027-09')
    expect(s.priceCents).toBe($(850_000))
    expect(s.loanCents).toBeGreaterThan($(800_000))
    expect(s.depositReadyMonth).toBe('now')
    expect(early.house?.house.costsCents).toBe($(34_890.50 + 395.10 + 225.10 + 2_200 + 650))
  })
  it('one income for 12 months: lower net worth by 2030 even with +$250/mo', () => {
    expect(sum(leave).netWorthAtCents!).toBeLessThan(sum(base).netWorthAtCents!)
    expect(sum(leave).lowestCash!.cents).toBeLessThanOrEqual(sum(base).lowestCash!.cents)
  })
  it('the deposit goal follows the scenario’s own house', () => {
    expect(depositGoal(early)?.targetCents).toBe($(85_000))
    expect(depositGoal(base)?.targetCents).toBe($(250_000))
  })
})

describe('diffing', () => {
  it('assumptions that differ from the baseline', () => {
    const rows = data().assumptionRows
    const d = diffAssumptions(resolveAssumptions('base', scenarios, rows), resolveAssumptions('early-hi', scenarios, rows))
    expect(d).toEqual([{ key: 'mortgage_rate_pct', label: 'Mortgage rate', from: 6, to: 7 }])
    expect(diffAssumptions(resolveAssumptions('base', scenarios, rows), resolveAssumptions('early', scenarios, rows))).toEqual([])
  })
  it('house plans', () => {
    const a = { date: '2028-03-01', params: houseParams({ price_cents: $(1_000_000), deposit_cents: $(250_000) }, null, '2028-03-01')! }
    const b = { date: '2027-09-01', params: houseParams({ price_cents: $(850_000), deposit_cents: $(85_000), use_deposit_scheme: true }, null, '2027-09-01')! }
    expect(diffHouse(a, b)).toEqual([
      { field: 'Month', from: '2028-03', to: '2027-09' },
      { field: 'Price', from: '$1,000,000', to: '$850,000' },
      { field: 'Upfront cash', from: '$250,000', to: '$85,000' },
      { field: '5% scheme', from: 'no', to: 'yes' },
    ])
    expect(diffHouse(a, a)).toEqual([])
    expect(diffHouse(a, null)).toEqual([{ field: 'House purchase', from: 'planned', to: 'none' }])
  })
  it('example scenarios are built from the plan', () => {
    const ex = exampleScenarios({ houseMonth: '2028-03', mortgageRatePct: 6, today: '2026-11-13' })
    expect(ex.map(e => e.name)).toEqual(['$850k in 2027 with the 5% scheme', 'One income for 12 months', 'Rates +1%'])
    expect(ex[0].house).toEqual({ month: '2027-09', priceCents: $(850_000), upfrontCents: $(85_000), useScheme: true })
    expect(ex[1].leave).toEqual({ personIndex: 1, startMonth: '2028-03', months: 12, payPct: 0 })
    expect(ex[2].assumptions).toEqual({ mortgage_rate_pct: 7 })
  })
})

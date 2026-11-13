// Phase 5: salary sacrifice + FHSS in the projection, uncertainty bands,
// super to retirement, Home Loan mode, per-person assumptions.
// Worked examples are written so they can be checked by hand.

import { describe, it, expect } from 'vitest'
import { runProjection } from './projection/engine'
import { $, account, assumptions, baseInput, FLAT } from './projection/fixtures'
import { lognormalRatio, cohortBands, projectionBands, Z90 } from './projection/bands'
import { superToRetirement, monthsToRetirement } from './projection/retirement'
import { payoff, balanceAfter, homeLoanStatus, isLoanMode } from './house/homeLoan'
import { fhssProjectionMonths } from './house/fhss'
import { plannedSacrificeInFy, superCapLines } from './superCap'
import { withEffect, depositHitDay, attachDepositDays } from './insights/goalImpact'
import { fhssWindow } from './insights/rules/super'
import { spending } from './projection/fixtures'
import type { InsightContext } from './insights/types'
import {
  resolvePersonAssumptions, validateAssumptionValues, parsePersonAssumptionKey, assumptionLabel, birthMonthKey, assumptionKeysFor,
} from './assumptions'
import type { ProjectionInput, Salary, HouseParams } from './projection/types'

const salary = (personKey: string, grossDollars: number): Salary => ({
  id: `sal-${personKey}`, personKey, description: 'Salary', grossAnnualCents: $(grossDollars), startDate: '2020-01-01', endDate: null, indexation: 'none', indexationPct: null,
})

// One earner keeps the tax maths simple to check: Evan, $135k, private cover, no HELP.
const evanOnly = (over: Partial<ProjectionInput> = {}) => baseInput({
  people: [{ key: 'evan', name: 'Evan', hasPrivateHospital: true, hasHecs: false }],
  salaries: [salary('evan', 135_000)],
  accounts: [account('joint', 'bank', 0), account('evan-super', 'super', 50_000, { owner: 'evan' })],
  months: 7, // Dec 2026 – Jun 2027, all FY2026-27
  ...over,
})

describe('salary sacrifice in the projection', () => {
  it('worked example: Evan $135k sacrificing $10,000/yr in FY2026-27', () => {
    // Without: taxable $135,000 → tax 15% × 26,800 + 30% × 90,000 = $31,020; Medicare 2% = $2,700 → $33,720.
    //   Take-home $101,280/yr = $8,440/mo.
    // With $10k sacrifice: taxable $125,000 → tax $4,020 + $24,000 = $28,020; Medicare $2,500 → $30,520.
    //   Take-home $135,000 − $10,000 − $30,520 = $94,480/yr ($6,800/yr less: the $10k costs 68c in the dollar).
    //   Super gets $10,000 × 85% = $8,500/yr extra.
    const without = runProjection(evanOnly())
    const withSac = runProjection(evanOnly({ sacrifice: [{ personKey: 'evan', annualCents: $(10_000) }] }))
    const m0 = without.months[0], m1 = withSac.months[0]
    expect(m0.cashflow.takeHomeCents).toBe($(8_440))
    // $11,250 − $2,543.33 tax − $833.33 sacrifice
    expect(m1.cashflow.takeHomeCents).toBe(1_125_000 - 254_333 - 83_333)
    expect(m1.cashflow.sacrificeCents).toBe(83_333)
    expect(m0.cashflow.takeHomeCents - m1.cashflow.takeHomeCents).toBe(56_666) // ≈ $6,800 / 12
    // Super: SG $16,200 × 85% = $13,770/yr (unchanged) + $8,500/yr sacrifice.
    const sup = (m: typeof m0) => m.trace.filter(t => t.accountId === 'evan-super' && t.kind === 'super').reduce((s, t) => s + t.cents, 0)
    expect(sup(m0)).toBe($(1_147.50))
    expect(sup(m1)).toBe($(1_147.50) + 70_833)
    expect(m1.trace.some(t => t.label === 'Evan: salary sacrifice')).toBe(true)
    // Over 7 months: net worth is $6,800 × 7/12 lower in cash but $8,500 × 7/12 higher in super.
    const last0 = without.months[6], last1 = withSac.months[6]
    expect(last1.netWorthCents - last0.netWorthCents).toBe(7 * (70_833 - 56_666))
  })

  it('is capped at the concessional cap after employer super and entered contributions', () => {
    // FY2026-27 cap $32,500 − SG $16,200 = $16,300 room; a $5,000 contribution entered on Track › Income leaves $11,300.
    const p = runProjection(evanOnly({
      sacrifice: [{ personKey: 'evan', annualCents: $(20_000) }],
      cashflows: [{ id: 'cc', description: 'Concessional', kind: 'super_contribution', personKey: 'evan', amountCents: $(5_000), currency: 'AUD', frequency: 'once', startDate: '2027-03-15', endDate: null, indexation: 'none', indexationPct: null, accountId: null, toAccountId: null, eventId: null, concessional: true }],
    }))
    expect(p.months[0].cashflow.sacrificeCents).toBe(Math.round($(11_300) / 12))
    expect(p.warnings.join(' ')).toMatch(/limited to \$11,300 a year in FY2026-27/)
  })

  it('scales with leave (no pay, no sacrifice)', () => {
    const p = runProjection(evanOnly({
      sacrifice: [{ personKey: 'evan', annualCents: $(10_000) }],
      events: [{ id: 'lv', name: 'Leave', kind: 'leave', date: '2027-01-01', status: 'planned', house: null, leave: { personKey: 'evan', payPct: 0, endDate: '2027-01-31' } }],
    }))
    expect(p.months[1].cashflow.sacrificeCents).toBe(0)
    expect(p.months[2].cashflow.sacrificeCents).toBe(83_333)
  })

  it('no sacrifice leaves the projection exactly as before', () => {
    const a = runProjection(evanOnly())
    const b = runProjection(evanOnly({ sacrifice: [] }))
    expect(b.months.map(m => m.netWorthCents)).toEqual(a.months.map(m => m.netWorthCents))
    expect(a.fhss).toEqual([])
  })
})

describe('FHSS in the projection', () => {
  // House in Mar 2028 → request Jan 2028, money lands Feb 2028.
  const months = fhssProjectionMonths('2028-03')
  it('request two months before, release one month before the purchase', () => {
    expect(months).toEqual({ requestMonth: '2028-01', releaseMonth: '2028-02' })
  })

  const run = (fhss: boolean, sicRatePct?: number) => runProjection(evanOnly({
    months: 16, // Dec 2026 – Mar 2028
    sacrifice: [{ personKey: 'evan', annualCents: $(10_000) }],
    fhss: fhss ? { ...months, ...(sicRatePct !== undefined ? { sicRatePct } : {}) } : null,
  }))

  it('worked example (no deemed earnings): 13 months × $833.33 counted, 85% released, taxed at 32% less 30%', () => {
    // Counted Dec 2026 – Dec 2027 = 13 × $833.33 = $10,833.29. Releasable 85% = $9,208.30.
    // Release FY2027-28, taxable $125,000: 32% (30% + 2% Medicare) on whole dollars $9,208 = $2,946.56,
    // less the 30% offset on $9,208.30 = $2,762.49 → $184.07 tax.
    const p = run(true, 0)
    expect(p.fhss).toHaveLength(1)
    const r = p.fhss[0]
    expect(r.month).toBe('2028-02')
    expect(r.countedCents).toBe(13 * 83_333)
    expect(r.deemedEarningsCents).toBe(0)
    expect(r.releasableContribCents).toBe(Math.round(13 * 83_333 * 0.85))
    expect(r.releasedCents).toBe(920_830)
    expect(r.taxCents).toBe(18_407)
    expect(r.netCents).toBe(920_830 - 18_407)
    // Lands in cash (the deposit pot) in Feb 2028 and comes out of super.
    const feb = p.months.find(m => m.month === '2028-02')!
    expect(feb.cashflow.fhssReleaseCents).toBe(r.netCents)
    expect(feb.trace.filter(t => t.kind === 'fhss').reduce((s, t) => s + t.nwCents, 0)).toBe(-r.taxCents)
  })

  it('deemed earnings at the shortfall interest charge rate compound monthly', () => {
    const r = run(true).fhss[0]
    expect(r.deemedEarningsCents).toBeGreaterThan($(400))
    expect(r.deemedEarningsCents).toBeLessThan($(500))
    expect(r.releasedCents).toBe(r.releasableContribCents + r.deemedEarningsCents)
  })

  it('moves the deposit pot: higher in the release month than sacrifice without FHSS', () => {
    const on = run(true), off = run(false)
    const feb = (p: typeof on) => p.months.find(m => m.month === '2028-02')!.depositPotCents
    expect(feb(on) - feb(off)).toBe(on.fhss[0].netCents)
  })

  it('respects the $15,000 a year FHSS limit', () => {
    // A full FY (Jul 2027 – Jun 2028) at $30k asked: the cap allows $16,300 of sacrifice, FHSS counts $15,000 of it.
    const p = runProjection(evanOnly({
      startMonth: '2027-07', months: 14, sacrifice: [{ personKey: 'evan', annualCents: $(30_000) }],
      fhss: { requestMonth: '2028-07', releaseMonth: '2028-08', sicRatePct: 0 },
    }))
    expect(p.months[0].cashflow.sacrificeCents).toBe(Math.round($(16_300) / 12))
    expect(p.fhss[0].countedCents).toBe($(15_000))
    expect(p.fhss[0].releasedCents).toBe($(12_750))
  })

  it('insight effect: adds sacrifice and switches FHSS on', () => {
    const input = evanOnly({ months: 16 })
    const e = withEffect(input, { sacrifice: [{ personKey: 'evan', annualCents: $(5_000) }], fhss: months })
    expect(e.sacrifice).toEqual([{ personKey: 'evan', annualCents: $(5_000) }])
    expect(e.fhss).toEqual(months)
    const e2 = withEffect({ ...input, sacrifice: [{ personKey: 'evan', annualCents: $(1_000) }] }, { sacrifice: [{ personKey: 'evan', annualCents: $(5_000) }], fhss: months })
    expect(e2.sacrifice).toEqual([{ personKey: 'evan', annualCents: $(6_000) }])
    expect(depositHitDay(runProjection(e), $(1_000_000))).toBeNull()
  })
})

describe('FHSS insight card gets real deposit days', () => {
  const people = [
    { key: 'evan', name: 'Evan', grossCents: $(135000), hasPrivateHospital: true, hasHecs: false, voluntaryConcessionalCents: 0 },
    { key: 'rachel', name: 'Rachel', grossCents: $(107000), hasPrivateHospital: true, hasHecs: false, voluntaryConcessionalCents: 0 },
  ]
  const house = { eventName: 'Home', date: '2028-03-01', priceCents: $(1_000_000), cashCents: $(250_000), firstHome: true, kind: 'established' as const, useScheme: false }
  const ctx = (fhssMonths: { requestMonth: string; releaseMonth: string } | null): InsightContext => ({
    today: '2026-11-13', thisMonth: '2026-11', transactions: [], categories: [], budgets: [], accounts: [], cashRatePct: 4.5,
    monthlySpendCents: $(4000), deposit: null, previousCheckin: null, house, people, fhssReleaseMonth: '2028-01',
    subscriptions: [], subscriptionMarks: [], plannedEur: [], eurAudRate: 1.65, fhssMonths,
  })
  it('the effect is the FHSS room as yearly salary sacrifice, released the month before buying', () => {
    const [i] = fhssWindow(ctx(fhssProjectionMonths('2028-03')))
    expect(i.depositEffect).toEqual({
      sacrifice: [{ personKey: 'evan', annualCents: $(15_000) }, { personKey: 'rachel', annualCents: $(15_000) }],
      fhss: { requestMonth: '2028-01', releaseMonth: '2028-02' },
    })
    expect(fhssWindow(ctx(null))[0].depositEffect).toBeNull()
  })
  it('deposit days are worked out by the projection engine', () => {
    // Both earning, $9k/month spending, $150k saved; target $250k by Mar 2028.
    const input = baseInput({
      months: 60, accounts: [account('joint', 'bank', 150_000), account('es', 'super', 50_000, { owner: 'evan' }), account('rs', 'super', 40_000, { owner: 'rachel' })],
      salaries: [salary('evan', 135_000), salary('rachel', 107_000)], spending: spending(9_000),
    })
    const [i] = fhssWindow(ctx(fhssProjectionMonths('2028-03')))
    const [withDays] = attachDepositDays([i], input, $(250_000))
    expect(typeof withDays.depositDays).toBe('number')
    // Sanity: re-run by hand and compare the hit days.
    const base = depositHitDay(runProjection(input), $(250_000))!
    const after = depositHitDay(runProjection(withEffect(input, i.depositEffect!)), $(250_000))!
    expect(withDays.depositDays).toBe(Math.round(base - after))
  })
})

describe('uncertainty bands', () => {
  it('lognormal ratio: mean-preserving, wider with time', () => {
    const c = { returnPct: 7, volatilityPct: 16 }
    expect(lognormalRatio(0, c, Z90)).toBe(1)
    // 1 year: s² = ln(1 + 0.16²/1.07²) = 0.022113, s = 0.148705; p90 = exp(−0.011057 + 1.28155 × 0.148705) = 1.1966
    expect(lognormalRatio(1, c, Z90)).toBeCloseTo(1.1966, 3)
    expect(lognormalRatio(1, c, -Z90)).toBeCloseTo(0.8174, 3)
    expect(lognormalRatio(10, c, Z90) - lognormalRatio(10, c, -Z90)).toBeGreaterThan(lognormalRatio(1, c, Z90) - lognormalRatio(1, c, -Z90))
    expect(lognormalRatio(5, { returnPct: 7, volatilityPct: 0 }, Z90)).toBe(1)
  })

  it('one lump growing 12 months: mean = deterministic, p10/p90 = 1-year ratios', () => {
    const c = { returnPct: 7, volatilityPct: 16 }
    const bal = [100_000_00], growth = [0]
    for (let i = 1; i <= 12; i++) { const g = Math.round(bal[i - 1] * (Math.pow(1.07, 1 / 12) - 1)); growth.push(g); bal.push(bal[i - 1] + g) }
    const b = cohortBands(bal, growth, c)
    expect(b[12].mean).toBe(bal[12])
    expect(b[12].p90 / bal[12]).toBeCloseTo(lognormalRatio(1, c, Z90), 4)
    expect(b[12].p10 / bal[12]).toBeCloseTo(lognormalRatio(1, c, -Z90), 4)
    expect(b[0]).toEqual({ p10: bal[0], p50: bal[0], p90: bal[0], mean: bal[0] })
  })

  it('new money is less uncertain than old money; withdrawals shrink cohorts pro rata', () => {
    const c = { returnPct: 0, volatilityPct: 20 }
    const b = cohortBands([1_000_00, 1_000_00, 2_000_00, 1_000_00], [0, 0, 0, 0], c)
    expect(b[2].mean).toBe(2_000_00)
    expect(b[3].mean).toBe(1_000_00)
    expect(b[3].p90 - b[3].mean).toBeGreaterThan(0)
  })

  it('cash stays deterministic in the net worth band', () => {
    const p = runProjection(baseInput({ accounts: [account('joint', 'bank', 10_000), account('etf', 'investment', 50_000)], assumptions: assumptions({ inflation_pct: 0, wage_growth_pct: 0, cash_return_pct: 0 }) }))
    const bands = projectionBands(p, { invest: { returnPct: 7, volatilityPct: 16 }, super: { returnPct: 7, volatilityPct: 10 } })
    const last = bands[bands.length - 1]
    expect(last.netWorth.mean).toBe(p.months[p.months.length - 1].netWorthCents)
    expect(last.netWorth.p90 - last.netWorth.mean).toBe(last.invest.p90 - last.invest.mean + last.super.p90 - last.super.mean)
    expect(last.netWorth.p10).toBeLessThan(last.netWorth.mean)
  })
})

describe('super to retirement', () => {
  it('reads each person at 60, in today’s dollars, with a band', () => {
    // Evan born Jun 1967 turns 60 in Jun 2027 (7th projected month). Flat rates: super = $50k + 7 × $1,147.50 SG.
    expect(monthsToRetirement('2026-12', ['1967-06', null])).toBe(12) // at least a year
    expect(monthsToRetirement('2026-12', ['1990-01'])).toBe(278)
    const input = evanOnly({ months: 7 })
    expect(input.months).toBe(7)
    const p = runProjection(input)
    const [v] = superToRetirement(p, input.people, { evan: '1967-06' }, { inflationPct: 0, super: { returnPct: 0, volatilityPct: 10 } })
    expect(v.status).toBe('ok')
    expect(v.retireMonth).toBe('2027-06')
    expect(v.nominalCents).toBe($(50_000) + 7 * $(1_147.50))
    expect(v.todayCents).toBe(v.nominalCents)
    expect(v.band!.p10).toBeLessThan(v.todayCents!)
    expect(v.band!.p90).toBeGreaterThan(v.todayCents!)
  })

  it('deflates by inflation and reports missing birth months', () => {
    const input = evanOnly({ months: 13 })
    const p = runProjection(input)
    const [v] = superToRetirement(p, input.people, { evan: '1966-12' }, { inflationPct: 3, super: { returnPct: 0, volatilityPct: 0 } })
    expect(v.retireMonth).toBe('2026-12')
    // Dec 2026 is the first projected month (index 1): 1 month of 3% inflation.
    expect(v.todayCents).toBe(Math.round(v.nominalCents! / Math.pow(1.03, 1 / 12)))
    expect(superToRetirement(p, input.people, {}, { inflationPct: 3, super: { returnPct: 0, volatilityPct: 0 } })[0].status).toBe('no-birth-month')
    expect(superToRetirement(p, input.people, { evan: '1960-01' }, { inflationPct: 3, super: { returnPct: 0, volatilityPct: 0 } })[0].status).toBe('already-60')
  })
})

describe('Home Loan mode', () => {
  it('worked example: $750k at 6% over 30 years, with and without a $50k offset', () => {
    // Repayment = 750,000 × 0.005 / (1 − 1.005^−360) = $4,496.63.
    const pay = 449_663
    const plain = payoff($(750_000), 6, pay, 0, '2028-04')!
    expect(plain.months).toBe(360)
    expect(plain.month).toBe('2058-03')
    const off = payoff($(750_000), 6, pay, $(50_000), '2028-04')!
    expect(off.months).toBeLessThan(330)
    expect(off.months).toBeGreaterThan(300)
    expect(plain.totalInterestCents - off.totalInterestCents).toBeGreaterThan($(100_000))
    // Interest-only payment never pays off.
    expect(payoff($(750_000), 6, $(3_750), 0, '2028-04')).toBeNull()
  })

  it('balance after a year of repayments', () => {
    // 1st month: interest $3,750, principal $746.63 → $749,253.37.
    expect(balanceAfter($(750_000), 6, 449_663, 0, 1)).toBe(74_925_337)
  })

  const house: HouseParams = {
    priceCents: $(1_000_000), upfrontCents: $(250_000), costsCents: $(45_000), costsSource: 'calculated', loanTermMonths: 360,
    rentMonthlyCents: 0, firstHome: true, propertyKind: 'established', useScheme: false, offsetAccountId: 'offset', extraRepaymentMonthlyCents: 0,
  }

  it('loan mode starts in the purchase month or when marked bought, and is reversible', () => {
    expect(isLoanMode({ date: '2028-03-01', status: 'planned' }, '2028-02')).toBe(false)
    expect(isLoanMode({ date: '2028-03-01', status: 'planned' }, '2028-03')).toBe(true)
    expect(isLoanMode({ date: '2028-03-01', status: 'done' }, '2026-11')).toBe(true)
    expect(isLoanMode({ date: '2028-03-01', status: 'cancelled' }, '2029-01')).toBe(false)
    expect(isLoanMode(null, '2029-01')).toBe(false)
  })

  it('real data: mortgage account + linked offset', () => {
    const s = homeLoanStatus({
      thisMonth: '2028-06',
      accounts: [
        account('offset', 'offset', 40_000),
        account('loan', 'mortgage', -790_000, { interestRatePct: 6, loan: { repaymentCents: $(4_800), repaymentFreq: 'monthly', startDate: '2028-03-01', termMonths: 360, interestOnly: false, offsetAccountId: 'offset' } }),
      ],
      house: { date: '2028-03-01', status: 'done', params: house }, mortgageRatePct: 6.5, extras: [$(500)],
    })
    expect(s.source).toBe('account')
    expect(s.balanceCents).toBe($(790_000))
    expect(s.offsetCents).toBe($(40_000))
    // Interest on $750,000 at 0.5% = $3,750; the offset saves $40,000 × 0.5% = $200.
    expect(s.interestThisMonthCents).toBe($(3_750))
    expect(s.savedByOffsetThisMonthCents).toBe($(200))
    expect(s.effectiveRatePct).toBeCloseTo(6 * 750 / 790, 2)
    expect(s.repaymentCents).toBe($(4_800))
    expect(s.payoff!.months).toBeLessThan(s.payoffWithoutOffset!.months)
    expect(s.extras[0].monthsSaved).toBeGreaterThan(0)
    expect(s.extras[0].interestSavedCents).toBeGreaterThan(0)
  })

  it('falls back to the plan when there is no mortgage account', () => {
    const s = homeLoanStatus({
      thisMonth: '2028-03', accounts: [account('offset', 'offset', 20_000)],
      house: { date: '2028-03-01', status: 'planned', params: house }, mortgageRatePct: 6,
    })
    // Loan = $1,000,000 − ($250,000 − $45,000) = $795,000, nothing repaid yet.
    expect(s.source).toBe('plan')
    expect(s.balanceCents).toBe($(795_000))
    expect(s.notes.join(' ')).toMatch(/Track › Accounts/)
  })
})

describe('per-person assumptions', () => {
  const scenarios = [{ id: 'base', parent_scenario_id: null }, { id: 'nofhss', parent_scenario_id: 'base' }]
  const rows = [
    { scenario_id: 'base', key: 'salary_sacrifice__evan', value: 10_000 },
    { scenario_id: 'nofhss', key: 'salary_sacrifice__evan', value: 0 },
    { scenario_id: 'base', key: 'birth_month__rachel', value: 199204 },
  ]
  it('resolves with inheritance per person', () => {
    const base = resolvePersonAssumptions('base', scenarios, rows, ['evan', 'rachel'])
    expect(base.evan.salary_sacrifice).toEqual({ value: 10_000, source: 'scenario', scenarioId: 'base' })
    expect(base.rachel.salary_sacrifice.source).toBe('default')
    const fork = resolvePersonAssumptions('nofhss', scenarios, rows, ['evan', 'rachel'])
    expect(fork.evan.salary_sacrifice.value).toBe(0)
    expect(fork.rachel.birth_month).toEqual({ value: 199204, source: 'inherited', scenarioId: 'base' })
  })
  it('validates, labels and parses keys', () => {
    expect(parsePersonAssumptionKey('salary_sacrifice__evan')).toEqual({ base: 'salary_sacrifice', personKey: 'evan' })
    expect(parsePersonAssumptionKey('inflation_pct')).toBeNull()
    expect(parsePersonAssumptionKey('bogus__evan')).toBeNull()
    expect(assumptionLabel('salary_sacrifice__evan', [{ key: 'evan', name: 'Evan' }])).toBe('Evan: salary sacrifice')
    const r = validateAssumptionValues({ salary_sacrifice__evan: '12000', birth_month__evan: '199213', fhss_use: '2', investment_volatility_pct: '15' })
    expect(r.values).toEqual({ salary_sacrifice__evan: 12_000, investment_volatility_pct: 15 })
    expect(Object.keys(r.errors).sort()).toEqual(['birth_month__evan', 'fhss_use'])
    expect(birthMonthKey(199204)).toBe('1992-04')
    expect(birthMonthKey(0)).toBeNull()
    expect(assumptionKeysFor(['evan'])).toContain('birth_month__evan')
  })
  it('FLAT fixture still has every household key', () => {
    expect(FLAT.fhss_use).toBe(0)
  })
})

describe('super cap tracker with the plan’s salary sacrifice', () => {
  it('counts the months still to come this FY', () => {
    // Today 13 Nov 2026, projection from Dec: Dec–Jun = 7 months of $12,000/yr = $7,000.
    expect(plannedSacrificeInFy($(12_000), '2026-12', '2026-11-13')).toBe($(7_000))
    expect(plannedSacrificeInFy($(12_000), '2027-01', '2026-12-20')).toBe($(6_000))
    // Today in June: the projection starts in July, a new FY, so nothing this FY.
    expect(plannedSacrificeInFy($(12_000), '2027-07', '2027-06-10')).toBe(0)
  })
  it('reduces the room left', () => {
    const [l] = superCapLines([{ key: 'evan', name: 'Evan', grossCents: $(135_000), hasPrivateHospital: true, hasHecs: false, plannedSacrificeCents: $(7_000) }], [], '2026-11-13')
    // $32,500 − $16,200 SG − $7,000 planned = $9,300
    expect(l.plannedCents).toBe($(7_000))
    expect(l.headroomCents).toBe($(9_300))
  })
})

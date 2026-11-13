import { describe, it, expect } from 'vitest'
import { runProjection, annuityPayment, indexFactor } from './engine'
import { $, FLAT, account, assumptions, baseInput, spending } from './fixtures'
import type { ProjCashflow, ProjEvent, Projection, Salary } from './types'

const rachel: Salary = { id: 's-r', personKey: 'rachel', description: 'Rachel salary', grossAnnualCents: $(105_000), startDate: '2024-01-01', endDate: null, indexation: 'wages', indexationPct: null }
const evan: Salary = { id: 's-e', personKey: 'evan', description: 'Evan salary', grossAnnualCents: $(90_000), startDate: '2024-01-01', endDate: null, indexation: 'wages', indexationPct: null }

function cashflow(over: Partial<ProjCashflow>): ProjCashflow {
  return {
    id: 'cf', description: 'Item', kind: 'expense', personKey: null, amountCents: -$(1_000), currency: 'AUD',
    frequency: 'once', startDate: '2027-03-15', endDate: null, indexation: 'none', indexationPct: null,
    accountId: null, toAccountId: null, eventId: null, ...over,
  }
}

const house = (over: Partial<ProjEvent> = {}): ProjEvent => ({
  id: 'house', name: 'Buy our first home', kind: 'house_purchase', date: '2028-03-01', status: 'planned',
  house: { priceCents: $(1_000_000), upfrontCents: $(250_000), costsCents: $(45_000), costsSource: 'entered', loanTermMonths: 360, rentMonthlyCents: 0, firstHome: true, propertyKind: 'established', useScheme: false, offsetAccountId: null, extraRepaymentMonthlyCents: 0 },
  ...over,
})

const m = (p: Projection, month: string) => {
  const r = p.months.find(x => x.month === month)
  if (!r) throw new Error(`no month ${month}`)
  return r
}

/** Every month: the trace's net-worth effects add up exactly to the change in net worth. */
function expectTraceExplainsNetWorth(p: Projection) {
  let prev = p.opening.netWorthCents
  for (const mo of p.months) {
    const explained = mo.trace.filter(t => !t.memo).reduce((s, t) => s + t.nwCents, 0)
    expect(explained, mo.month).toBe(mo.netWorthCents - prev)
    // and every balance change is in the trace
    const moved = mo.trace.filter(t => !t.memo && t.accountId).reduce((s, t) => s + t.cents, 0)
    expect(moved, mo.month).toBe(mo.netWorthCents - prev)
    prev = mo.netWorthCents
  }
}

describe('golden case: two salaries, flat rates', () => {
  const input = baseInput({
    salaries: [rachel, evan],
    spending: spending(6_000),
    accounts: [account('joint', 'bank', 10_000), account('r-super', 'super', 50_000, { owner: 'rachel' }), account('e-super', 'super', 40_000, { owner: 'evan' })],
  })
  const p = runProjection(input)

  it('month one: take-home in, spending out, super in', () => {
    const dec = m(p, '2026-12')
    // Rachel $80,880/yr → $6,740/mo; Evan $70,680/yr → $5,890/mo (FY2026-27)
    expect(dec.cashflow.takeHomeCents).toBe($(6_740) + $(5_890))
    expect(dec.cashflow.grossPayCents).toBe($(8_750) + $(7_500))
    expect(dec.cashflow.taxCents).toBe($(2_010) + $(1_610))
    expect(dec.balances.joint).toBe($(10_000) + $(12_630) - $(6_000))
    // SG 12% less 15% contributions tax: $12,600 × 0.85 / 12, $10,800 × 0.85 / 12
    expect(dec.balances['r-super']).toBe($(50_000) + $(892.5))
    expect(dec.balances['e-super']).toBe($(40_000) + $(765))
    expect(dec.cashflow.netCashCents).toBe($(6_630))
  })

  it('carries the cash forward month after month', () => {
    expect(m(p, '2027-06').balances.joint).toBe($(10_000) + 7 * $(6_630))
  })

  it('new FY on 1 July: the 14% bottom rate lifts take-home (FY2027-28)', () => {
    const jul = m(p, '2027-07')
    expect(jul.fy).toBe('FY2027-28')
    // Rachel $81,148/yr, Evan $70,948/yr (−$268 tax each vs FY2026-27)
    expect(jul.cashflow.takeHomeCents).toBe($(8_750) - Math.round($(23_852) / 12) + $(7_500) - Math.round($(19_052) / 12))
  })

  it('net worth = cash + super, liquid = cash, deposit pot = sweep', () => {
    const last = p.months[p.months.length - 1]
    expect(last.netWorthCents).toBe(last.balances.joint + last.balances['r-super'] + last.balances['e-super'])
    expect(last.liquidCents).toBe(last.balances.joint)
    expect(last.superCents).toBe(last.balances['r-super'] + last.balances['e-super'])
    expect(last.depositPotCents).toBe(last.balances.joint)
  })

  it('every month is fully traced', () => expectTraceExplainsNetWorth(p))

  it('is deterministic', () => expect(runProjection(input)).toEqual(p))

  it('pay rises step on 1 July, not monthly', () => {
    const grown = runProjection({ ...input, assumptions: { ...FLAT, wage_growth_pct: 3.5 } })
    expect(m(grown, '2027-06').cashflow.grossPayCents).toBe($(8_750) + $(7_500))
    expect(m(grown, '2027-07').cashflow.grossPayCents).toBe(Math.round($(105_000) * 1.035 / 12) + Math.round($(90_000) * 1.035 / 12))
  })
})

describe('income edge cases', () => {
  it('zero-income months: salary ends, spending keeps going', () => {
    const p = runProjection(baseInput({ salaries: [{ ...rachel, endDate: '2027-02-28' }], spending: spending(2_000) }))
    expect(m(p, '2027-02').cashflow.takeHomeCents).toBe($(6_740))
    expect(m(p, '2027-03').cashflow.takeHomeCents).toBe(0)
    expect(m(p, '2027-04').balances.joint - m(p, '2027-03').balances.joint).toBe(-$(2_000))
    // The Settings net income does NOT step in for someone who has a salary row
    const withNet = runProjection(baseInput({ salaries: [{ ...rachel, endDate: '2027-02-28' }], netIncomes: [{ personKey: 'rachel', label: 'Rachel', monthlyNetCents: $(6_713), source: 'Settings' }] }))
    expect(m(withNet, '2027-03').cashflow.takeHomeCents).toBe(0)
  })

  it('net income from Settings is used for people without a gross salary', () => {
    const p = runProjection(baseInput({ salaries: [rachel], netIncomes: [
      { personKey: 'rachel', label: 'Rachel', monthlyNetCents: $(6_713), source: 'Settings' },
      { personKey: 'evan', label: 'Evan', monthlyNetCents: $(5_854), source: 'Settings' },
    ] }))
    expect(m(p, '2026-12').cashflow.takeHomeCents).toBe($(6_740) + $(5_854))
  })

  it('no super account: a placeholder is created and flagged', () => {
    const p = runProjection(baseInput({ salaries: [rachel] }))
    expect(p.accounts.some(a => a.id === 'super:rachel' && a.synthetic)).toBe(true)
    expect(p.warnings.join(' ')).toMatch(/Rachel has no super account/)
  })

  it('no hospital cover and combined income over the family threshold → MLS', () => {
    const p = runProjection(baseInput({
      salaries: [{ ...rachel, grossAnnualCents: $(120_000) }, { ...evan, grossAnnualCents: $(100_000) }],
      people: [{ key: 'rachel', name: 'Rachel', hasPrivateHospital: false, hasHecs: false }, { key: 'evan', name: 'Evan', hasPrivateHospital: false, hasHecs: false }],
    }))
    const tax = m(p, '2026-12').trace.find(t => t.kind === 'tax' && t.label.startsWith('Rachel'))
    expect(tax?.detail).toMatch(/MLS \$1,200/)
  })
})

describe('planned cashflows', () => {
  it('one-off expense lands in its month', () => {
    const p = runProjection(baseInput({ cashflows: [cashflow({ amountCents: -$(30_000), description: 'Business investment' })] }))
    expect(m(p, '2027-02').balances.joint).toBe($(10_000))
    expect(m(p, '2027-03').balances.joint).toBe(-$(20_000))
    expect(m(p, '2027-03').trace.some(t => t.label === 'Business investment' && t.ref?.id === 'cf')).toBe(true)
    expect(p.warnings.join(' ')).toMatch(/Cash goes below zero/)
  })

  it('EUR items convert at the FX rate', () => {
    const p = runProjection(baseInput({ cashflows: [cashflow({ amountCents: -$(8_000), currency: 'EUR' })] }))
    expect(m(p, '2027-03').balances.joint).toBe($(10_000) - $(13_200))
    expect(m(p, '2027-03').trace.find(t => t.kind === 'planned')?.detail).toMatch(/8,000 EUR at 1\.65/)
  })

  it('a currency with no rate is left out and flagged', () => {
    const p = runProjection(baseInput({ cashflows: [cashflow({ currency: 'GBP' })] }))
    expect(m(p, '2027-03').balances.joint).toBe($(10_000))
    expect(p.warnings.join(' ')).toMatch(/No GBP exchange rate/)
  })

  it('a one-off later this month (before the first projected month) lands in month one', () => {
    const p = runProjection(baseInput({ cashflows: [cashflow({ startDate: '2026-11-20' })] }))
    expect(m(p, '2026-12').balances.joint).toBe($(9_000))
  })

  it('recurring monthly + fortnightly items, with inflation indexation from 1 July', () => {
    const p = runProjection(baseInput({
      assumptions: { ...FLAT, inflation_pct: 3 },
      cashflows: [
        cashflow({ id: 'gym', description: 'Gym', frequency: 'monthly', startDate: '2026-12-31', amountCents: -$(100), indexation: 'inflation' }),
        cashflow({ id: 'side', kind: 'income', description: 'Side income', frequency: 'fortnightly', startDate: '2026-12-04', amountCents: $(500) }),
      ],
    }))
    // Dec 2026: 4, 18 → 2 fortnights; gym on 31st
    expect(m(p, '2026-12').balances.joint - $(10_000)).toBe(2 * $(500) - $(100))
    // Jan 2027: 1, 15, 29 → 3 fortnights
    expect(m(p, '2027-01').trace.find(t => t.ref?.id === 'side')?.label).toBe('Side income ×3')
    // Feb: gym clamps to the 28th; July: +3%
    expect(m(p, '2027-02').trace.find(t => t.ref?.id === 'gym')?.cents).toBe(-$(100))
    expect(m(p, '2027-07').trace.find(t => t.ref?.id === 'gym')?.cents).toBe(-$(103))
  })

  it('transfers move money without changing net worth', () => {
    const p = runProjection(baseInput({
      accounts: [account('joint', 'bank', 10_000), account('etf', 'investment', 0, { isLiquid: false })],
      cashflows: [cashflow({ kind: 'transfer', amountCents: $(1_000), frequency: 'monthly', startDate: '2026-12-01', toAccountId: 'etf' })],
    }))
    const dec = m(p, '2026-12')
    expect(dec.balances.etf).toBe($(1_000))
    expect(dec.netWorthCents).toBe(p.opening.netWorthCents)
    expectTraceExplainsNetWorth(p)
  })

  it('cashflows linked to an excluded event are left out', () => {
    const p = runProjection(baseInput({
      events: [house()],
      cashflows: [cashflow({ eventId: 'house', startDate: '2028-03-01', amountCents: -$(5_000) })],
      excludeEventKinds: ['house_purchase'],
    }))
    expect(m(p, '2028-03').balances.joint).toBe($(10_000))
    expect(m(p, '2028-03').pins).toEqual([])
  })
})

describe('growth', () => {
  it('savings interest r/12 on the opening balance; returns compound monthly', () => {
    const p = runProjection(baseInput({
      assumptions: assumptions({ cash_return_pct: 4.8, investment_return_pct: 7, super_return_pct: 7, inflation_pct: 0, wage_growth_pct: 0 }),
      accounts: [account('joint', 'bank', 10_000), account('etf', 'investment', 100_000), account('s', 'super', 100_000, { owner: 'rachel', annualFeeCents: $(120) })],
    }))
    const dec = m(p, '2026-12')
    expect(dec.balances.joint).toBe($(10_040))
    expect(dec.balances.etf).toBe($(100_000) + Math.round($(100_000) * (Math.pow(1.07, 1 / 12) - 1)))
    expect(dec.balances.s).toBe($(100_000) + Math.round($(100_000) * (Math.pow(1.07, 1 / 12) - 1)) - $(10))
    // 12 months of compounding ≈ 7%
    expect(m(p, '2027-11').balances.etf).toBeGreaterThan($(106_990))
    expect(m(p, '2027-11').balances.etf).toBeLessThan($(107_010))
    expectTraceExplainsNetWorth(p)
  })

  it('an account rate overrides the assumption', () => {
    const p = runProjection(baseInput({ assumptions: { ...FLAT, cash_return_pct: 4.5 }, accounts: [account('joint', 'bank', 12_000, { interestRatePct: 1 })] }))
    expect(m(p, '2026-12').balances.joint).toBe($(12_010))
  })
})

describe('loans', () => {
  it('annuity maths', () => {
    expect(annuityPayment($(100_000), 6, 12)).toBe($(8_606.64))
    expect(annuityPayment($(1_200), 0, 12)).toBe($(100))
    expect(annuityPayment(0, 6, 12)).toBe(0)
    expect(annuityPayment($(500), 6, 1)).toBe($(500))
  })

  it('amortises to zero over the term', () => {
    const loan = account('car', 'loan', -100_000, { interestRatePct: 6, loan: { repaymentCents: null, repaymentFreq: null, startDate: '2026-12-01', termMonths: 12, interestOnly: false, offsetAccountId: null } })
    const p = runProjection(baseInput({ accounts: [account('joint', 'bank', 200_000), loan] }))
    expect(m(p, '2026-12').balances.car).toBe(-$(100_000) - $(500) + $(8_606.64))
    expect(m(p, '2027-11').balances.car).toBe(0)
    expect(m(p, '2027-12').cashflow.loanRepaymentCents).toBe(0)
    const totalInterest = p.months.reduce((s, x) => s + x.cashflow.loanInterestCents, 0)
    expect(m(p, '2027-11').balances.joint).toBe($(200_000) - $(100_000) - totalInterest)
    expectTraceExplainsNetWorth(p)
  })

  it('fixed repayments: fortnightly converted to monthly', () => {
    const loan = account('car', 'loan', -10_000, { interestRatePct: 0, loan: { repaymentCents: $(300), repaymentFreq: 'fortnightly', startDate: null, termMonths: null, interestOnly: false, offsetAccountId: null } })
    const p = runProjection(baseInput({ accounts: [account('joint', 'bank', 50_000), loan] }))
    expect(m(p, '2026-12').cashflow.loanRepaymentCents).toBe($(650))
  })

  it('no repayment details: interest-only, balance held, flagged', () => {
    const loan = account('car', 'loan', -10_000, { interestRatePct: 12, loan: { repaymentCents: null, repaymentFreq: null, startDate: null, termMonths: null, interestOnly: false, offsetAccountId: null } })
    const p = runProjection(baseInput({ accounts: [account('joint', 'bank', 50_000), loan] }))
    expect(m(p, '2027-06').balances.car).toBe(-$(10_000))
    expect(p.warnings.join(' ')).toMatch(/no repayment details/)
  })

  it('offset: interest only on the balance above the offset, offset earns nothing', () => {
    const loan = account('home', 'mortgage', -500_000, { interestRatePct: 6, loan: { repaymentCents: null, repaymentFreq: null, startDate: null, termMonths: null, interestOnly: true, offsetAccountId: 'off' } })
    const p = runProjection(baseInput({
      assumptions: { ...FLAT, cash_return_pct: 4.5 },
      accounts: [account('joint', 'bank', 20_000), account('off', 'offset', 100_000), loan],
    }))
    const dec = m(p, '2026-12')
    expect(dec.cashflow.loanInterestCents).toBe($(2_000)) // 6% / 12 on $400k
    expect(dec.balances.off).toBe($(100_000))
    expect(dec.balances.home).toBe(-$(500_000))
  })
})

describe('house purchase', () => {
  const input = baseInput({
    months: 60,
    accounts: [account('joint', 'bank', 250_000), account('savings', 'savings', 30_000), account('etf', 'investment', 40_000, { isLiquid: false })],
    depositAccountIds: ['joint', 'savings', 'etf'],
    events: [house({ house: { ...house().house!, rentMonthlyCents: $(2_500) } })],
    spending: spending(4_000),
  })
  const p = runProjection(input)

  it('draws the upfront cash (sweep, then cash, then investments) and creates home + mortgage', () => {
    const mar = m(p, '2028-03')
    expect(mar.pins.map(x => x.name)).toEqual(['Buy our first home'])
    // Sweep had $250k − 16 × $4k spending = $186k by Mar-28 before the draw
    expect(mar.balances.joint).toBe(0)
    expect(mar.balances.savings).toBe(0)
    expect(mar.balances.etf).toBe($(6_000))
    expect(mar.balances['house:house']).toBe($(1_000_000))
    expect(mar.balances['mortgage:house']).toBe(-$(795_000))
    expect(mar.cashflow.eventCostsCents).toBe($(45_000))
    // Net worth falls by duty + costs (and the month's spending)
    expect(mar.netWorthCents - m(p, '2028-02').netWorthCents).toBe(-$(45_000) - $(4_000))
  })

  it('mortgage repayments start the next month; rent stops', () => {
    const apr = m(p, '2028-04')
    expect(apr.cashflow.loanInterestCents).toBe($(3_975))
    expect(apr.cashflow.loanRepaymentCents).toBe(annuityPayment($(795_000), 6, 360))
    expect(apr.cashflow.spendingCents).toBe($(1_500))
    expectTraceExplainsNetWorth(p)
  })

  it('shortfall is flagged, not hidden', () => {
    const poor = runProjection({ ...input, accounts: [account('joint', 'bank', 50_000)], depositAccountIds: ['joint'], spending: spending(0) })
    expect(m(poor, '2028-03').balances.joint).toBe(-$(200_000))
    expect(poor.warnings.join(' ')).toMatch(/Short \$200,000/)
  })

  it('a done event is a pin only; excluded kinds are skipped', () => {
    const done = runProjection({ ...input, events: [house({ status: 'done' })] })
    expect(m(done, '2028-03').pins).toHaveLength(1)
    expect(m(done, '2028-03').balances['house:house']).toBeUndefined()
    const excl = runProjection({ ...input, excludeEventKinds: ['house_purchase'] })
    expect(m(excl, '2028-03').pins).toHaveLength(0)
  })
})

describe('Phase 3: offset, extra repayments, leave', () => {
  const input = baseInput({
    months: 60,
    accounts: [account('joint', 'bank', 300_000), account('off', 'savings', 50_000)],
    depositAccountIds: ['joint'],
    events: [house()],
  })

  it('the repayment is fixed at drawdown; extra repayments are added', () => {
    const p = runProjection({ ...input, events: [house({ house: { ...house().house!, extraRepaymentMonthlyCents: $(500) } })] })
    const sched = annuityPayment($(795_000), 6, 360)
    expect(m(p, '2028-04').cashflow.loanRepaymentCents).toBe(sched + $(500))
    expect(m(p, '2029-04').cashflow.loanRepaymentCents).toBe(sched + $(500))
    expectTraceExplainsNetWorth(p)
  })

  it('an offset account cuts mortgage interest and stops earning interest itself', () => {
    const withOff = runProjection({ ...input, assumptions: { ...FLAT, cash_return_pct: 4 }, events: [house({ house: { ...house().house!, offsetAccountId: 'off' } })] })
    const without = runProjection({ ...input, assumptions: { ...FLAT, cash_return_pct: 4 } })
    // Apr-28: interest on $795k less the offset balance ($50k plus interest earned before the purchase)
    expect(m(withOff, '2028-04').cashflow.loanInterestCents).toBe(Math.round(($(795_000) - m(withOff, '2028-03').balances.off) * 0.06 / 12))
    expect(m(without, '2028-04').cashflow.loanInterestCents).toBe($(3_975))
    // Before the purchase the account still earns savings interest; after, nothing
    expect(m(withOff, '2028-02').trace.some(t => t.accountId === 'off' && t.kind === 'interest')).toBe(true)
    expect(m(withOff, '2028-05').trace.some(t => t.accountId === 'off' && t.kind === 'interest')).toBe(false)
    expectTraceExplainsNetWorth(withOff)
  })

  it('leave pays the person a share of salary for its months only', () => {
    const leave: ProjEvent = { id: 'lv', name: 'Rachel on leave', kind: 'leave', date: '2027-02-01', status: 'planned', house: null, leave: { personKey: 'rachel', payPct: 0, endDate: '2027-04-30' } }
    const p = runProjection(baseInput({ salaries: [rachel, evan], events: [leave] }))
    expect(m(p, '2027-01').cashflow.takeHomeCents).toBe($(6_740) + $(5_890))
    expect(m(p, '2027-02').cashflow.takeHomeCents).toBe($(5_890))
    expect(m(p, '2027-04').cashflow.takeHomeCents).toBe($(5_890))
    expect(m(p, '2027-05').cashflow.takeHomeCents).toBe($(6_740) + $(5_890))
    expect(m(p, '2027-02').pins.map(x => x.name)).toEqual(['Rachel on leave'])
    const half = runProjection(baseInput({ salaries: [rachel], events: [{ ...leave, leave: { ...leave.leave!, payPct: 50 } }] }))
    expect(m(half, '2027-02').cashflow.grossPayCents).toBe(Math.round($(105_000) / 2 / 12))
  })
})

describe('misc', () => {
  it('no sweep account: an "Unallocated cash" account is created', () => {
    const p = runProjection(baseInput({ accounts: [], sweepAccountId: null, depositAccountIds: [], salaries: [rachel] }))
    expect(p.sweepAccountId).toBe('cash:unallocated')
    expect(m(p, '2026-12').balances['cash:unallocated']).toBe($(6_740))
  })

  it('flags FYs whose tax settings are carried forward', () => {
    const p = runProjection(baseInput({ salaries: [rachel], months: 48 }))
    expect(p.extrapolatedFys).toEqual(['FY2028-29', 'FY2029-30', 'FY2030-31'])
  })

  it('30-year horizon runs and stays traced', () => {
    const p = runProjection(baseInput({ months: 360, assumptions: assumptions(), salaries: [rachel, evan], spending: spending(7_000), events: [house()] }))
    expect(p.months).toHaveLength(360)
    expect(p.months[359].month).toBe('2056-11')
    expectTraceExplainsNetWorth(p)
  })

  it('indexFactor steps whole FYs', () => {
    expect(indexFactor('none', null, 3, FLAT)).toBe(1)
    expect(indexFactor('custom', 10, 2, FLAT)).toBeCloseTo(1.21)
    expect(indexFactor('wages', null, -1, assumptions())).toBe(1)
  })
})

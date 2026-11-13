import { describe, it, expect } from 'vitest'
import { waDuty, generalDutyCents, dutyCurve, offThePlanPct } from './duty'
import { purchase, lmiEstimate, landgateTransferFeeCents, fhogEligibility, depositSchemeEligibility, cashNeededFor } from './purchase'
import { borrowingPower, loanForRepayment, repaymentFor } from './borrowing'
import { mortgageSchedule, compareMortgage, rateShock } from './mortgage'
import { fhssVsCash, fhssTimeline } from './fhss'
import { allHouseSources, ruleFor, WA_DUTY, WA_FHOG } from './rules'

const $ = (d: number) => Math.round(d * 100)
const AFTER = '2027-09-01' // contract date under the 7 May 2026 rules
const fhb = (price: number, kind: Parameters<typeof waDuty>[0]['kind'] = 'established', contractDate = AFTER) =>
  waDuty({ priceCents: $(price), firstHome: true, kind, contractDate })
const gen = (price: number) => generalDutyCents($(price), ruleFor(WA_DUTY, AFTER).general)

describe('WA transfer duty: general rate (RevenueWA scale)', () => {
  it('matches RevenueWA figures and the band bases', () => {
    expect(gen(850_000)).toBe($(34_890.50))   // RevenueWA off-the-plan worked example
    expect(gen(1_000_000)).toBe($(42_615.50))
    expect(gen(120_000)).toBe($(2_280))       // band bases are continuous
    expect(gen(150_000)).toBe($(3_135))
    expect(gen(360_000)).toBe($(11_115))
    expect(gen(725_000)).toBe($(28_452.50)) // RevenueWA rounds the next band's base to $28,453
    expect(gen(600_000)).toBe($(22_515))
    expect(gen(0)).toBe(0)
  })
  it('charges per $100 or part (rounds the excess up)', () => {
    expect(gen(725_001)).toBe($(28_453) + 515)
    expect(gen(725_100)).toBe($(28_453) + 515)
    expect(gen(725_101)).toBe($(28_453) + 1030)
  })
})

describe('WA first home owner rate (agreements from 7 May 2026)', () => {
  it('is nil to $600k, $16.15/$100 to $800k, general above', () => {
    expect(fhb(500_000).payableCents).toBe(0)
    expect(fhb(600_000).payableCents).toBe(0)
    expect(fhb(600_001).payableCents).toBe(1615)
    expect(fhb(650_000).payableCents).toBe($(8_075))
    expect(fhb(700_000).payableCents).toBe($(16_150))
    expect(fhb(750_000).payableCents).toBe($(24_225))
    expect(fhb(799_999).payableCents).toBe($(32_300))
    expect(fhb(800_000).payableCents).toBe($(32_300))
    expect(fhb(800_001).payableCents).toBe($(32_320.65))   // cap passed → general rate on the whole value
    expect(fhb(850_000).payableCents).toBe($(34_890.50))
    expect(fhb(1_000_000).payableCents).toBe($(42_615.50))
  })
  it('reports the basis and the saving', () => {
    expect(fhb(550_000).basis).toBe('exempt')
    expect(fhb(700_000).basis).toBe('first_home_rate')
    expect(fhb(700_000).savingCents).toBe(gen(700_000) - $(16_150))
    expect(fhb(900_000).basis).toBe('general')
    expect(fhb(900_000).note).toMatch(/over the \$800,000/)
  })
  it('vacant land: nil to $450k, $20.14/$100 to $550k', () => {
    expect(fhb(450_000, 'vacant_land').payableCents).toBe(0)
    expect(fhb(500_000, 'vacant_land').payableCents).toBe($(10_070))
    expect(fhb(550_000, 'vacant_land').payableCents).toBe($(20_140))
    expect(fhb(550_001, 'vacant_land').basis).toBe('general')
  })
  it('older agreements use the old thresholds', () => {
    expect(fhb(600_000, 'established', '2026-01-15').payableCents).toBe($(13_630))  // $13.63 × 1,000 parts over $500k
    expect(fhb(750_000, 'established', '2026-01-15').basis).toBe('general')
  })
  it('non first home buyers pay the general rate', () => {
    const d = waDuty({ priceCents: $(500_000), firstHome: false, kind: 'established', contractDate: AFTER })
    expect(d.payableCents).toBe(gen(500_000))
    expect(d.fhorCents).toBeNull()
  })
})

describe('off-the-plan concession', () => {
  it('tapers 100% → 50% (pre) and 75% → 37.5% (under) between $800k and $900k', () => {
    const r = ruleFor(WA_DUTY, AFTER).offThePlan
    expect(offThePlanPct($(800_000), 'pre', r, AFTER)).toBe(100)
    expect(offThePlanPct($(850_000), 'pre', r, AFTER)).toBe(75)
    expect(offThePlanPct($(900_000), 'pre', r, AFTER)).toBe(50)
    expect(offThePlanPct($(850_000), 'under', r, AFTER)).toBeCloseTo(56.25)
    expect(offThePlanPct($(950_000), 'under', r, AFTER)).toBe(37.5)
    expect(offThePlanPct($(850_000), 'pre', r, '2028-07-01')).toBe(0) // window closed
  })
  it('uses whichever is lower, capped at $50k', () => {
    const d = waDuty({ priceCents: $(850_000), firstHome: true, kind: 'off_the_plan_pre', contractDate: AFTER })
    expect(d.basis).toBe('off_the_plan')
    expect(d.payableCents).toBe($(34_890.50) - Math.round($(34_890.50) * 0.75))
    const big = waDuty({ priceCents: $(3_000_000), firstHome: false, kind: 'off_the_plan_pre', contractDate: AFTER })
    expect(big.offThePlanConcessionCents).toBe($(50_000))
    const fhbUnder = waDuty({ priceCents: $(700_000), firstHome: true, kind: 'off_the_plan_pre', contractDate: AFTER })
    expect(fhbUnder.payableCents).toBe(0)
  })
  it('the duty curve has the first-home slope and the general rate above $800k', () => {
    const c = dutyCurve({ firstHome: true, kind: 'established', contractDate: AFTER }, $(550_000), $(900_000), $(50_000))
    expect(c.map(x => x.dutyCents / 100)).toEqual([0, 0, 8_075, 16_150, 24_225, 32_300, 34_890.5, 37_465.5])
  })
})

describe('FHOG and the 5% Deposit Scheme', () => {
  it('FHOG: first home, new only, cap $800k south of the 26th', () => {
    expect(fhogEligibility({ priceCents: $(700_000), firstHome: true, kind: 'new', contractDate: AFTER }).amountCents).toBe($(10_000))
    expect(fhogEligibility({ priceCents: $(800_000), firstHome: true, kind: 'off_the_plan_pre', contractDate: AFTER }).eligible).toBe(true)
    expect(fhogEligibility({ priceCents: $(800_001), firstHome: true, kind: 'new', contractDate: AFTER }).eligible).toBe(false)
    const est = fhogEligibility({ priceCents: $(500_000), firstHome: true, kind: 'established', contractDate: AFTER })
    expect(est.eligible).toBe(false)
    expect(est.reasons[0]).toMatch(/Established/)
    expect(fhogEligibility({ priceCents: $(700_000), firstHome: false, kind: 'new', contractDate: AFTER }).eligible).toBe(false)
    expect(fhogEligibility({ priceCents: $(780_000), firstHome: true, kind: 'new', contractDate: '2026-01-01' }).eligible).toBe(false) // old $750k cap
    expect(ruleFor(WA_FHOG, '2026-05-07').capSouthCents).toBe($(800_000))
  })
  it('5% scheme: Perth cap $850k, 5% minimum, first home buyers', () => {
    const ok = depositSchemeEligibility({ priceCents: $(850_000), depositCents: $(42_500), firstHome: true, contractDate: AFTER })
    expect(ok.eligible).toBe(true)
    expect(depositSchemeEligibility({ priceCents: $(850_001), depositCents: $(100_000), firstHome: true, contractDate: AFTER }).eligible).toBe(false)
    expect(depositSchemeEligibility({ priceCents: $(800_000), depositCents: $(39_999), firstHome: true, contractDate: AFTER }).reasons[0]).toMatch(/5%/)
    expect(depositSchemeEligibility({ priceCents: $(650_000), depositCents: $(40_000), firstHome: true, contractDate: AFTER, area: 'rest_of_wa' }).eligible).toBe(false)
  })
})

describe('LMI (indicative table)', () => {
  it('is nil to 80% LVR and steps by band', () => {
    expect(lmiEstimate($(400_000), $(500_000)).totalCents).toBe(0)
    const at85 = lmiEstimate($(425_000), $(500_000))
    expect(at85.ratePct).toBe(1.1)
    expect(at85.premiumCents).toBe($(4_675))
    expect(at85.totalCents).toBe($(5_142.50))
    expect(lmiEstimate($(450_000), $(500_000)).ratePct).toBe(2)
    expect(lmiEstimate($(475_000), $(500_000)).ratePct).toBe(3.6)
    expect(lmiEstimate($(480_000), $(500_000)).overMaxLvr).toBe(true)
  })
  it('loads larger loans', () => {
    expect(lmiEstimate($(855_000), $(900_000)).ratePct).toBeCloseTo(4.14)
  })
})

describe('whole purchase', () => {
  it('$1M established, $250k cash, first home: general duty, no LMI', () => {
    const r = purchase({ priceCents: $(1_000_000), cashCents: $(250_000), firstHome: true, kind: 'established', contractDate: '2028-03-01', useScheme: false })
    expect(r.duty.payableCents).toBe($(42_615.50))
    expect(landgateTransferFeeCents($(1_000_000))).toBe($(415.10))
    expect(r.feesCents).toBe($(415.10 + 225.10 + 2_200 + 650))
    expect(r.depositCents).toBe($(250_000 - 42_615.50 - 3_490.20))
    expect(r.loanCents).toBe($(1_000_000) - r.depositCents)
    expect(r.lmi.totalCents).toBe(0)
    expect(r.lvrPct).toBeCloseTo(79.61, 1)
    expect(r.costsCents + r.depositCents).toBe(r.cashCents)
  })
  it('$850k on the 5% scheme: no LMI, loan ~95%', () => {
    const r = purchase({ priceCents: $(850_000), cashCents: $(85_000), firstHome: true, kind: 'established', contractDate: '2027-09-01', useScheme: true })
    expect(r.scheme.eligible).toBe(true)
    expect(r.schemeApplied).toBe(true)
    expect(r.lmi.totalCents).toBe(0)
    expect(r.depositCents).toBe($(85_000 - 34_890.50 - 395.10 - 225.10 - 2_200 - 650))
    expect(r.problems).toEqual([])
  })
  it('same price without the scheme pays LMI out of the deposit', () => {
    const r = purchase({ priceCents: $(850_000), cashCents: $(120_000), firstHome: true, kind: 'established', contractDate: '2027-09-01', useScheme: false })
    expect(r.lmi.totalCents).toBeGreaterThan(0)
    expect(r.depositCents + r.costsCents).toBeLessThanOrEqual(r.cashCents)
    expect(r.cashCents - (r.depositCents + r.costsCents)).toBeLessThan(100)
  })
  it('new build under $800k gets FHOG; cash short of duty is flagged', () => {
    const r = purchase({ priceCents: $(700_000), cashCents: $(60_000), firstHome: true, kind: 'new', contractDate: AFTER, useScheme: true })
    expect(r.fhog.amountCents).toBe($(10_000))
    expect(r.lines.find(l => l.key === 'fhog')?.cents).toBe(-$(10_000))
    const short = purchase({ priceCents: $(1_000_000), cashCents: $(20_000), firstHome: true, kind: 'established', contractDate: AFTER, useScheme: false })
    expect(short.problems[0]).toMatch(/doesn’t cover duty/)
  })
  it('cashNeededFor inverts purchase at 20%', () => {
    const need = cashNeededFor({ priceCents: $(900_000), firstHome: true, kind: 'established', contractDate: AFTER, useScheme: false, depositPct: 20 })
    const r = purchase({ priceCents: $(900_000), cashCents: need, firstHome: true, kind: 'established', contractDate: AFTER, useScheme: false })
    expect(r.depositCents).toBe($(180_000))
    expect(r.lmi.totalCents).toBe(0)
  })
})

describe('borrowing power (indicative)', () => {
  const people = [
    { name: 'Rachel', grossCents: $(105_000), hasPrivateHospital: true, hasHecs: false },
    { name: 'Evan', grossCents: $(90_000), hasPrivateHospital: true, hasHecs: false },
  ]
  it('golden case: $195k gross, $4,000/mo living, 6% + 3% buffer', () => {
    const r = borrowingPower({ people, fy: 'FY2026-27', livingMonthlyCents: $(4_000), otherDebtMonthlyCents: 0, otherDebtBalanceCents: 0, ratePct: 6, termMonths: 360 })
    expect(r.netMonthlyCents).toBe($(12_630))            // $80,880 + $70,680 a year
    expect(r.assessedRatePct).toBe(9)
    expect(r.surplusMonthlyCents).toBe($(8_630))
    expect(r.highCents).toBe(loanForRepayment($(8_630), 9, 360))
    expect(r.highCents / 100).toBeGreaterThan(1_070_000)
    expect(r.highCents / 100).toBeLessThan(1_075_000)
    expect(r.lowCents).toBeLessThan(r.highCents)
    expect(r.dti6Cents).toBe($(1_170_000))
    expect(r.expenseBasis).toBe('actual')
  })
  it('uses the HEM-style floor when actual spending is lower', () => {
    const r = borrowingPower({ people, fy: 'FY2026-27', livingMonthlyCents: $(2_000), otherDebtMonthlyCents: $(500), otherDebtBalanceCents: $(20_000), ratePct: 6, termMonths: 360 })
    expect(r.expenseBasis).toBe('hem_floor')
    expect(r.expensesMonthlyCents).toBe($(3_760))
    expect(r.surplusMonthlyCents).toBe($(12_630 - 3_760 - 500))
    expect(r.dti6Cents).toBe($(1_150_000))
  })
  it('no surplus → nothing', () => {
    const r = borrowingPower({ people, fy: 'FY2026-27', livingMonthlyCents: $(13_000), otherDebtMonthlyCents: 0, otherDebtBalanceCents: 0, ratePct: 6, termMonths: 360 })
    expect(r.highCents).toBe(0)
  })
  it('loan ↔ repayment round-trips', () => {
    const pay = repaymentFor($(795_000), 6, 360)
    expect(pay / 100).toBeCloseTo(4_766.48, 0)
    expect(Math.abs(loanForRepayment(pay, 6, 360) - $(795_000))).toBeLessThan(200)
  })
})

describe('mortgage, offset and extra repayments', () => {
  it('a plain loan pays off over the term', () => {
    const r = mortgageSchedule({ loanCents: $(800_000), ratePct: 6, termMonths: 360 })
    expect(r.months).toBe(360)
    expect(r.repaymentCents / 100).toBeCloseTo(4_796.4, 0)
    expect(r.totalInterestCents / 100).toBeGreaterThan(926_000)
    expect(r.totalInterestCents / 100).toBeLessThan(928_000)
    expect(r.years[r.years.length - 1].balanceCents).toBe(0)
  })
  it('an offset saves interest and shortens the loan', () => {
    const c = compareMortgage({ loanCents: $(800_000), ratePct: 6, termMonths: 360, offsetCents: $(50_000) })
    expect(c.interestSavedCents).toBeGreaterThan(0)
    expect(c.monthsSaved).toBeGreaterThan(30)
    // First month: interest on $750k not $800k = $250 less
    const one = mortgageSchedule({ loanCents: $(800_000), ratePct: 6, termMonths: 1, offsetCents: $(50_000) })
    expect(one.totalInterestCents).toBe($(3_750))
  })
  it('extra repayments save interest', () => {
    const c = compareMortgage({ loanCents: $(800_000), ratePct: 6, termMonths: 360, extraMonthlyCents: $(500) })
    expect(c.withExtras.paymentCents).toBe(c.base.repaymentCents + $(500))
    expect(c.monthsSaved).toBeGreaterThan(60)
  })
  it('rate shock table', () => {
    const s = rateShock($(800_000), 6, 360)
    expect(s.map(x => x.ratePct)).toEqual([6, 7, 8, 9])
    expect(s[1].repaymentCents).toBeGreaterThan(s[0].repaymentCents)
  })
})

describe('FHSS vs cash', () => {
  const rachel = { name: 'Rachel', grossCents: $(105_000), hasPrivateHospital: true, hasHecs: false }
  it('golden case: $15k a year for FY26-27 (from Dec) and FY27-28, release Feb 2028', () => {
    const r = fhssVsCash({ person: rachel, startMonth: '2026-12', releaseMonth: '2028-02', annualContributionCents: $(15_000), cashRatePct: 4.5, sicRatePct: 7.5 })
    expect(r.rows.map(x => [x.fy, x.months, x.contributionCents])).toEqual([['FY2026-27', 7, $(15_000)], ['FY2027-28', 7, $(15_000)]])
    expect(r.contributedCents).toBe($(30_000))
    expect(r.releasableContribCents).toBe($(25_500))
    expect(r.deemedEarningsCents).toBeGreaterThan($(1_000))
    expect(r.deemedEarningsCents).toBeLessThan($(2_500))
    // $15k at 30% + 2% Medicare costs $10,200 of take-home a year
    expect(r.rows[0].takeHomeCostCents).toBe($(10_200))
    expect(r.takeHomeCostCents).toBe($(20_400))
    // Release taxed at (30% + 2%) − 30% = ~2% on the released amount (bracket edge aside)
    expect(r.releaseTaxCents / r.releasedCents).toBeGreaterThan(0.015)
    expect(r.releaseTaxCents / r.releasedCents).toBeLessThan(0.08)
    expect(r.netFhssCents).toBe(r.releasedCents - r.releaseTaxCents)
    expect(r.gainCents).toBe(r.netFhssCents - r.cashPathCents)
    expect(r.gainCents).toBeGreaterThan($(5_000))
  })
  it('caps at $15k per FY, the concessional cap and $50k lifetime', () => {
    const r = fhssVsCash({ person: rachel, startMonth: '2026-07', releaseMonth: '2030-07', annualContributionCents: $(20_000), cashRatePct: 4.5 })
    expect(r.rows.every(x => x.contributionCents <= $(15_000))).toBe(true)
    expect(r.contributedCents).toBe($(50_000))
    expect(r.rows.some(x => x.limitedBy === 'lifetime_cap')).toBe(true)
    const high = fhssVsCash({ person: { ...rachel, grossCents: $(200_000) }, startMonth: '2026-07', releaseMonth: '2027-07', annualContributionCents: $(15_000), cashRatePct: 4.5 })
    // SG $24,000 leaves $8,500 of the $32,500 cap
    expect(high.rows[0].contributionCents).toBe($(8_500))
    expect(high.rows[0].limitedBy).toBe('concessional_cap')
  })
  it('nothing to model when release is before start', () => {
    expect(fhssVsCash({ person: rachel, startMonth: '2027-01', releaseMonth: '2026-12', annualContributionCents: $(15_000), cashRatePct: 4.5 }).gainCents).toBe(0)
  })
  it('timeline: request ~2 months before signing; FYs available', () => {
    const t = fhssTimeline('2028-03', '2026-11-13')
    expect(t.requestBy).toBe('2028-01')
    expect(t.fys).toEqual(['FY2026-27', 'FY2027-28'])
  })
})

describe('rules config', () => {
  it('every figure cites a source with a check date', () => {
    const s = allHouseSources('2027-01-01')
    expect(s.length).toBeGreaterThan(15)
    for (const x of s) {
      expect(x.url).toMatch(/^https:\/\//)
      expect(x.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  it('picks the rule in force on a date', () => {
    expect(ruleFor(WA_DUTY, '2026-05-06').fhorHome.nilToCents).toBe($(500_000))
    expect(ruleFor(WA_DUTY, '2026-05-07').fhorHome.nilToCents).toBe($(600_000))
    expect(ruleFor(WA_DUTY, '2020-01-01').from).toBe('2025-03-21')
  })
})

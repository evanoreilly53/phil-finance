import { describe, it, expect } from 'vitest'
import { annualTakeHome, perPeriod, incomeTaxCents, litoCents, medicareLevyCents, helpRepaymentCents, mlsRate } from './takeHome'
import { fyOf, taxConfigFor, TAX_CONFIGS, type FyKey } from './config'

const $ = (d: number) => Math.round(d * 100)
const cfg = (fy: FyKey) => taxConfigFor(fy).config
const covered = { hasPrivateHospital: true, hasHecs: false }

describe('FY config lookup', () => {
  it('maps dates to July–June financial years', () => {
    expect(fyOf('2026-06-30')).toBe('FY2025-26')
    expect(fyOf('2026-07-01')).toBe('FY2026-27')
    expect(fyOf('2026-11-08')).toBe('FY2026-27')
    expect(fyOf('2099-12-31')).toBe('FY2099-00')
  })
  it('reuses the last config for later years and flags it', () => {
    expect(taxConfigFor('FY2026-27')).toEqual({ config: TAX_CONFIGS[1], extrapolated: false })
    const later = taxConfigFor('FY2031-32')
    expect(later.extrapolated).toBe(true)
    expect(later.config.fy).toBe('FY2027-28')
    expect(taxConfigFor('FY2019-20').config.fy).toBe('FY2025-26')
  })
  it('every config cites a source with a check date', () => {
    for (const c of TAX_CONFIGS) {
      expect(c.sources.length).toBeGreaterThan(0)
      for (const s of c.sources) {
        expect(s.url).toMatch(/^https:\/\/www\.ato\.gov\.au\//)
        expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })
})

describe('income tax brackets', () => {
  it('FY2026-27 matches the ATO base amounts', () => {
    const b = cfg('FY2026-27').brackets
    expect(incomeTaxCents($(18_200), b)).toBe(0)
    expect(incomeTaxCents($(45_000), b)).toBe($(4_020))
    expect(incomeTaxCents($(135_000), b)).toBe($(31_020))
    expect(incomeTaxCents($(190_000), b)).toBe($(51_370))
    expect(incomeTaxCents($(200_000), b)).toBe($(55_870))
  })
  it('FY2025-26 matches the ATO base amounts', () => {
    const b = cfg('FY2025-26').brackets
    expect(incomeTaxCents($(45_000), b)).toBe($(4_288))
    expect(incomeTaxCents($(135_000), b)).toBe($(31_288))
    expect(incomeTaxCents($(190_000), b)).toBe($(51_638))
  })
  it('drops cents from taxable income, never goes negative', () => {
    const b = cfg('FY2026-27').brackets
    expect(incomeTaxCents($(105_000) + 99, b)).toBe(incomeTaxCents($(105_000), b))
    expect(incomeTaxCents(-500, b)).toBe(0)
  })
})

describe('offsets and levies', () => {
  const c = cfg('FY2026-27')
  it('LITO tapers from $700 to nil at $66,667', () => {
    expect(litoCents($(30_000), c.lito)).toBe($(700))
    expect(litoCents($(40_000), c.lito)).toBe($(575))
    expect(litoCents($(50_000), c.lito)).toBe($(250))
    expect(litoCents($(66_667), c.lito)).toBe(0)
    expect(litoCents($(90_000), c.lito)).toBe(0)
  })
  it('Medicare levy: nil, shade-in, then the full 2%', () => {
    expect(medicareLevyCents($(20_000), c.medicare)).toBe(0)
    expect(medicareLevyCents($(30_000), c.medicare)).toBe($(198.9))
    expect(medicareLevyCents($(40_000), c.medicare)).toBe($(800))
    expect(medicareLevyCents($(105_000), c.medicare)).toBe($(2_100))
  })
  it('MLS tiers', () => {
    expect(mlsRate($(105_000), c.mls.singles)).toBe(0)
    expect(mlsRate($(110_000), c.mls.singles)).toBe(0.01)
    expect(mlsRate($(150_000), c.mls.singles)).toBe(0.0125)
    expect(mlsRate($(500_000), c.mls.singles)).toBe(0.015)
  })
  it('HELP is marginal, then a flat 10% of all income', () => {
    expect(helpRepaymentCents($(69_528), c.help)).toBe(0)
    expect(helpRepaymentCents($(105_000), c.help)).toBe($(5_320.8))
    expect(helpRepaymentCents($(140_000), c.help)).toBe($(10_776.46))
    expect(helpRepaymentCents($(200_000), c.help)).toBe($(20_000))
    expect(helpRepaymentCents($(90_000), cfg('FY2025-26').help)).toBe($(3_450))
  })
})

// Worked examples at the owners' salaries. Expected values are the ATO
// published schedule worked by hand (the same arithmetic the ATO simple tax
// calculator does): tax + 2% Medicare, no offsets at these incomes.
describe('worked examples: Rachel ~$105k, Evan ~$90k', () => {
  it('Rachel, FY2026-27', () => {
    const r = annualTakeHome({ grossCents: $(105_000), ...covered }, 'FY2026-27')
    expect(r.incomeTaxCents).toBe($(22_020))
    expect(r.litoCents).toBe(0)
    expect(r.medicareLevyCents).toBe($(2_100))
    expect(r.mlsCents).toBe(0)
    expect(r.helpCents).toBe(0)
    expect(r.totalTaxCents).toBe($(24_120))
    expect(r.netCents).toBe($(80_880))
    expect(r.sgCents).toBe($(12_600))
    expect(r.superNetCents).toBe($(10_710))
    expect(r.capHeadroomCents).toBe($(19_900))
    expect(r.marginalRate).toBe(0.30)
    expect(perPeriod(r, 'monthly').netCents).toBe($(6_740))
    expect(perPeriod(r, 'fortnightly').netCents).toBe($(3_110.77))
    expect(perPeriod(r, 'weekly').netCents).toBe($(1_555.38))
  })
  it('Evan, FY2026-27', () => {
    const e = annualTakeHome({ grossCents: $(90_000), ...covered }, 'FY2026-27')
    expect(e.totalTaxCents).toBe($(19_320))
    expect(e.netCents).toBe($(70_680))
    expect(perPeriod(e, 'monthly').netCents).toBe($(5_890))
    expect(perPeriod(e, 'fortnightly').netCents).toBe($(2_718.46))
    expect(e.sgCents).toBe($(10_800))
    expect(e.capHeadroomCents).toBe($(21_700))
  })
  it('FY2025-26 (16% bottom rate) costs each of them $268 more', () => {
    expect(annualTakeHome({ grossCents: $(105_000), ...covered }, 'FY2025-26').netCents).toBe($(80_612))
    expect(annualTakeHome({ grossCents: $(90_000), ...covered }, 'FY2025-26').netCents).toBe($(70_412))
    expect(annualTakeHome({ grossCents: $(90_000), ...covered }, 'FY2025-26').capHeadroomCents).toBe($(19_200))
  })
  it('FY2027-28 (14% bottom rate)', () => {
    expect(annualTakeHome({ grossCents: $(105_000), ...covered }, 'FY2027-28').netCents).toBe($(81_148))
  })
})

describe('flags: MLS, HELP, salary sacrifice', () => {
  it('no hospital cover, single: MLS above the base tier only', () => {
    expect(annualTakeHome({ grossCents: $(105_000), hasPrivateHospital: false, hasHecs: false }, 'FY2026-27').mlsCents).toBe(0)
    expect(annualTakeHome({ grossCents: $(110_000), hasPrivateHospital: false, hasHecs: false }, 'FY2026-27').mlsCents).toBe($(1_100))
  })
  it('no hospital cover, couple: family threshold on combined income, rate on own income', () => {
    const under = annualTakeHome({ grossCents: $(105_000), hasPrivateHospital: false, hasHecs: false, family: { combinedIncomeCents: $(195_000) } }, 'FY2026-27')
    expect(under.mlsCents).toBe(0)
    const over = annualTakeHome({ grossCents: $(105_000), hasPrivateHospital: false, hasHecs: false, family: { combinedIncomeCents: $(220_000) } }, 'FY2026-27')
    expect(over.mlsCents).toBe($(1_050))
    // Two children lift the family threshold by $1,500 (first child adds nothing)
    const kids = annualTakeHome({ grossCents: $(105_000), hasPrivateHospital: false, hasHecs: false, family: { combinedIncomeCents: $(211_000), dependantChildren: 2 } }, 'FY2026-27')
    expect(kids.mlsCents).toBe(0)
  })
  it('hospital cover switches MLS off whatever the income', () => {
    expect(annualTakeHome({ grossCents: $(300_000), ...covered }, 'FY2026-27').mlsCents).toBe(0)
  })
  it('HELP is deducted from take-home when switched on', () => {
    const r = annualTakeHome({ grossCents: $(105_000), hasPrivateHospital: true, hasHecs: true }, 'FY2026-27')
    expect(r.helpCents).toBe($(5_320.8))
    expect(r.netCents).toBe($(80_880) - $(5_320.8))
  })
  it('salary sacrifice lowers taxable income and uses cap room', () => {
    const r = annualTakeHome({ grossCents: $(105_000), salarySacrificeCents: $(10_000), ...covered }, 'FY2026-27')
    expect(r.taxableCents).toBe($(95_000))
    expect(r.totalTaxCents).toBe($(19_020) + $(1_900))
    expect(r.netCents).toBe($(74_080))
    expect(r.concessionalCents).toBe($(22_600))
    expect(r.capHeadroomCents).toBe($(9_900))
    expect(r.superNetCents).toBe($(19_210))
  })
  it('zero income is all zeros', () => {
    const r = annualTakeHome({ grossCents: 0, ...covered }, 'FY2026-27')
    expect(r.netCents).toBe(0)
    expect(r.totalTaxCents).toBe(0)
    expect(r.sgCents).toBe(0)
  })
  it('low income: LITO wipes most tax', () => {
    const r = annualTakeHome({ grossCents: $(30_000), ...covered }, 'FY2026-27')
    expect(r.incomeTaxCents).toBe($(1_770))
    expect(r.litoCents).toBe($(700))
    expect(r.totalTaxCents).toBe($(1_070) + $(198.9))
  })
})

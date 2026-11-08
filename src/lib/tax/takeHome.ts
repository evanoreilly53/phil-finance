// AU take-home pay engine. Pure and deterministic; all money is integer cents.
//
// Annual basis: tax is worked out on the year's taxable income (what you
// actually owe), then divided evenly into pay periods. Real payslips use the
// ATO PAYG withholding schedules, which can differ by a few dollars per pay;
// the difference comes back (or is owed) at tax time.
// Planning estimate, not tax advice.

import { taxConfigFor, type Bracket, type FyKey, type FyTaxConfig, type MlsTiers } from './config'

/** The ATO taxes whole dollars: cents are dropped from taxable income. */
function wholeDollars(cents: number): number {
  return Math.max(0, Math.floor(cents / 100) * 100)
}

export function incomeTaxCents(taxableCents: number, brackets: readonly Bracket[]): number {
  const income = wholeDollars(taxableCents)
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const lo = brackets[i].overCents
    const hi = i + 1 < brackets.length ? brackets[i + 1].overCents : Infinity
    if (income <= lo) break
    tax += (Math.min(income, hi) - lo) * brackets[i].rate
  }
  return Math.round(tax)
}

export function litoCents(taxableCents: number, lito: FyTaxConfig['lito']): number {
  const income = wholeDollars(taxableCents)
  if (income <= lito.fullToCents) return lito.maxCents
  if (income <= lito.taper1ToCents) return Math.max(0, Math.round(lito.maxCents - (income - lito.fullToCents) * lito.taper1Rate))
  const atTaper1 = lito.maxCents - (lito.taper1ToCents - lito.fullToCents) * lito.taper1Rate
  return Math.max(0, Math.round(atTaper1 - (income - lito.taper1ToCents) * lito.taper2Rate))
}

export function medicareLevyCents(taxableCents: number, m: FyTaxConfig['medicare']): number {
  const income = wholeDollars(taxableCents)
  if (income <= m.lowerCents) return 0
  return Math.round(Math.min(income * m.rate, (income - m.lowerCents) * m.shadeInRate))
}

/** Surcharge rate for an income against a tier table (0 at or below base). */
export function mlsRate(incomeCents: number, t: MlsTiers): number {
  if (incomeCents <= t.baseCents) return 0
  for (const tier of t.tiers) if (tier.upToCents === null || incomeCents <= tier.upToCents) return tier.rate
  return t.tiers[t.tiers.length - 1]?.rate ?? 0
}

export function helpRepaymentCents(repaymentIncomeCents: number, h: FyTaxConfig['help']): number {
  const income = wholeDollars(repaymentIncomeCents)
  if (income >= h.flatFromCents) return Math.round(income * h.flatRate)
  return incomeTaxCents(income, h.marginal)
}

export type TaxPerson = {
  /** Annual gross salary, EXCLUDING employer super. */
  grossCents: number
  /** Pre-tax salary sacrifice to super (reduces taxable income; counts toward the concessional cap). */
  salarySacrificeCents?: number
  hasPrivateHospital: boolean
  hasHecs: boolean
  /**
   * MLS test. Couples are assessed as a family: if combined income is over the
   * family threshold and you have no hospital cover, the surcharge rate is set
   * by the FAMILY tier and charged on your own income. Omit for singles.
   */
  family?: { combinedIncomeCents: number; dependantChildren?: number }
}

export type TaxBreakdown = {
  fy: FyKey
  extrapolated: boolean
  grossCents: number
  salarySacrificeCents: number
  taxableCents: number
  incomeTaxCents: number      // before offsets
  litoCents: number
  medicareLevyCents: number
  mlsCents: number
  helpCents: number
  totalTaxCents: number       // income tax − offsets + Medicare + MLS (HELP shown separately)
  netCents: number            // gross − sacrifice − total tax − HELP
  /** Employer SG (before 15% contributions tax). */
  sgCents: number
  /** What lands in super after 15% contributions tax: (SG + sacrifice) × 0.85. */
  superNetCents: number
  concessionalCents: number
  concessionalCapCents: number
  capHeadroomCents: number    // cap − concessional (negative = over the cap); carry-forward not modelled
  marginalRate: number        // income tax bracket rate at this income (excl. Medicare)
}

export function annualTakeHome(p: TaxPerson, fy: FyKey): TaxBreakdown {
  const { config, extrapolated } = taxConfigFor(fy)
  const gross = Math.max(0, Math.round(p.grossCents))
  const sacrifice = Math.min(gross, Math.max(0, Math.round(p.salarySacrificeCents ?? 0)))
  const taxable = gross - sacrifice

  const tax = incomeTaxCents(taxable, config.brackets)
  const lito = Math.min(tax, litoCents(taxable, config.lito)) // non-refundable
  const medicare = medicareLevyCents(taxable, config.medicare)

  let mls = 0
  if (!p.hasPrivateHospital) {
    const rate = p.family
      ? mlsRate(p.family.combinedIncomeCents, {
          ...config.mls.families,
          baseCents: config.mls.families.baseCents + Math.max(0, (p.family.dependantChildren ?? 0) - 1) * config.mls.perChildAfterFirstCents,
        })
      : mlsRate(wholeDollars(taxable), config.mls.singles)
    mls = Math.round(wholeDollars(taxable) * rate)
  }

  // Repayment income adds back reportable super contributions (salary sacrifice).
  const help = p.hasHecs ? helpRepaymentCents(taxable + sacrifice, config.help) : 0

  const totalTax = tax - lito + medicare + mls
  const sg = Math.round(Math.min(gross, config.super.maxContributionBaseAnnualCents) * config.super.sgRate)
  const concessional = sg + sacrifice

  let marginalRate = 0
  for (const b of config.brackets) if (wholeDollars(taxable) > b.overCents) marginalRate = b.rate

  return {
    fy,
    extrapolated,
    grossCents: gross,
    salarySacrificeCents: sacrifice,
    taxableCents: taxable,
    incomeTaxCents: tax,
    litoCents: lito,
    medicareLevyCents: medicare,
    mlsCents: mls,
    helpCents: help,
    totalTaxCents: totalTax,
    netCents: gross - sacrifice - totalTax - help,
    sgCents: sg,
    superNetCents: Math.round(concessional * (1 - config.super.contributionsTaxRate)),
    concessionalCents: concessional,
    concessionalCapCents: config.super.concessionalCapCents,
    capHeadroomCents: config.super.concessionalCapCents - concessional,
    marginalRate,
  }
}

export type PayFrequency = 'weekly' | 'fortnightly' | 'monthly'
export const PERIODS_PER_YEAR: Record<PayFrequency, number> = { weekly: 52, fortnightly: 26, monthly: 12 }

export type PerPeriod = { grossCents: number; taxCents: number; helpCents: number; sacrificeCents: number; netCents: number; superCents: number }

/** The annual figures spread evenly over pay periods (rounded to the cent). */
export function perPeriod(b: TaxBreakdown, freq: PayFrequency): PerPeriod {
  const n = PERIODS_PER_YEAR[freq]
  return {
    grossCents: Math.round(b.grossCents / n),
    taxCents: Math.round(b.totalTaxCents / n),
    helpCents: Math.round(b.helpCents / n),
    sacrificeCents: Math.round(b.salarySacrificeCents / n),
    netCents: Math.round(b.netCents / n),
    superCents: Math.round(b.sgCents / n),
  }
}

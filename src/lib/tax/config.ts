// Australian resident tax + super settings, one entry per financial year.
// DATA, not logic: next year's update is one new entry at the bottom.
//
// All money is integer cents. Rates are fractions (0.30 = 30%).
// Every figure carries a source and the date it was checked. Status:
//   verified   = matches ato.gov.au (read via ATO search snippets on the check date;
//                the ATO site blocks direct page fetches from our tooling)
//   secondary  = from a reputable secondary source (budget papers, calculators),
//                ATO page not readable at check date
//   unverified = carried forward / estimated; must be confirmed before relying on it
//
// Scope: "good enough" take-home (owner decision #3). Not modelled: deductions,
// CGT, Div 293, FHSS release tax, the 2027-28 Working Australians Tax Offset,
// reportable fringe benefits, MLS income add-backs (MLS uses taxable income here).
// Planning estimates only, not tax advice.

export type FyKey = `FY${number}-${number}`

/** Marginal schedule: `rate` applies to each dollar above `overCents`. */
export type Bracket = { overCents: number; rate: number }

/** HELP repayment: marginal rate above each threshold, then a flat % of ALL income at the top. */
export type HelpSchedule = {
  marginal: Bracket[]
  /** At or above this income, repayment is `flatRate` × whole repayment income. */
  flatFromCents: number
  flatRate: number
}

export type MlsTiers = {
  /** Base tier ceiling: income ≤ this pays no surcharge. */
  baseCents: number
  /** Tier ceilings above base, ascending, each with its rate. Last tier is open-ended. */
  tiers: { upToCents: number | null; rate: number }[]
}

export type SourceNote = {
  item: string
  url: string
  checked: string
  status: 'verified' | 'secondary' | 'unverified'
  note?: string
}

export type FyTaxConfig = {
  fy: FyKey
  start: string // YYYY-MM-DD (1 July)
  brackets: Bracket[]
  medicare: {
    rate: number
    /** Low-income reduction (singles). Nil ≤ lower; 10c/$ over lower until the full 2% is reached. */
    lowerCents: number
    shadeInRate: number
  }
  mls: {
    singles: MlsTiers
    families: MlsTiers
    perChildAfterFirstCents: number
  }
  lito: {
    maxCents: number
    fullToCents: number
    taper1ToCents: number
    taper1Rate: number
    taper2Rate: number
  }
  help: HelpSchedule
  super: {
    sgRate: number
    concessionalCapCents: number
    nonConcessionalCapCents: number
    /** Max contribution base expressed annually (SG not payable above this salary). */
    maxContributionBaseAnnualCents: number
    contributionsTaxRate: number
  }
  sources: SourceNote[]
}

const CHECKED = '2026-11-08'
const ATO_RATES = 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents'
const ATO_MLS = 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates'
const ATO_ML_LOW = 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners'
const ATO_LITO = 'https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset'
const ATO_HELP = 'https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds'
const ATO_SUPER = 'https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds'
const ATO_CUTS = 'https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer'

const $ = (dollars: number) => Math.round(dollars * 100)

const LITO = { maxCents: $(700), fullToCents: $(37_500), taper1ToCents: $(45_000), taper1Rate: 0.05, taper2Rate: 0.015 }

export const TAX_CONFIGS: readonly FyTaxConfig[] = [
  {
    fy: 'FY2025-26',
    start: '2025-07-01',
    brackets: [
      { overCents: $(18_200), rate: 0.16 },
      { overCents: $(45_000), rate: 0.30 },
      { overCents: $(135_000), rate: 0.37 },
      { overCents: $(190_000), rate: 0.45 },
    ],
    medicare: { rate: 0.02, lowerCents: $(28_011), shadeInRate: 0.10 },
    mls: {
      singles:  { baseCents: $(101_000), tiers: [{ upToCents: $(118_000), rate: 0.01 }, { upToCents: $(158_000), rate: 0.0125 }, { upToCents: null, rate: 0.015 }] },
      families: { baseCents: $(202_000), tiers: [{ upToCents: $(236_000), rate: 0.01 }, { upToCents: $(316_000), rate: 0.0125 }, { upToCents: null, rate: 0.015 }] },
      perChildAfterFirstCents: $(1_500),
    },
    lito: LITO,
    help: {
      marginal: [{ overCents: $(67_000), rate: 0.15 }, { overCents: $(125_000), rate: 0.17 }],
      flatFromCents: $(179_286),
      flatRate: 0.10,
    },
    super: {
      sgRate: 0.12,
      concessionalCapCents: $(30_000),
      nonConcessionalCapCents: $(120_000),
      maxContributionBaseAnnualCents: $(62_500) * 4, // quarterly base $62,500 in 2025-26
      contributionsTaxRate: 0.15,
    },
    sources: [
      { item: 'Resident brackets (16% / 30% / 37% / 45%)', url: ATO_RATES, checked: CHECKED, status: 'verified', note: 'Base amounts $4,288 / $31,288 / $51,638 match.' },
      { item: 'Medicare levy 2%', url: ATO_ML_LOW, checked: CHECKED, status: 'verified' },
      { item: 'Medicare low-income threshold $28,011 (single)', url: ATO_ML_LOW, checked: CHECKED, status: 'secondary', note: '2026 Budget figure (+2.9%), reported by austax.tools / wagecalculator. Irrelevant above ~$35k.' },
      { item: 'MLS thresholds $101k single / $202k family', url: ATO_MLS, checked: CHECKED, status: 'secondary', note: 'Prior-year figures quoted alongside the ATO 2026-27 update (finder.com.au, privatehealth.gov.au).' },
      { item: 'LITO $700, $37,500 / $45,000 / $66,667', url: ATO_LITO, checked: CHECKED, status: 'verified' },
      { item: 'HELP marginal: $67,000 / 15% / $125,000 / 17%, 10% flat from $179,286', url: ATO_HELP, checked: CHECKED, status: 'secondary', note: '$67,000 start and the rates are widely reported; the $179,286 flat point is derived (continuity with $8,700 + 17%). Owner has no HELP.' },
      { item: 'SG 12%, concessional cap $30,000, non-concessional $120,000', url: ATO_SUPER, checked: CHECKED, status: 'verified' },
      { item: 'Max contribution base $62,500 / quarter', url: ATO_SUPER, checked: CHECKED, status: 'secondary', note: 'Irrelevant at household salaries.' },
    ],
  },
  {
    fy: 'FY2026-27',
    start: '2026-07-01',
    brackets: [
      { overCents: $(18_200), rate: 0.15 },
      { overCents: $(45_000), rate: 0.30 },
      { overCents: $(135_000), rate: 0.37 },
      { overCents: $(190_000), rate: 0.45 },
    ],
    medicare: { rate: 0.02, lowerCents: $(28_011), shadeInRate: 0.10 },
    mls: {
      singles:  { baseCents: $(105_000), tiers: [{ upToCents: $(123_000), rate: 0.01 }, { upToCents: $(164_000), rate: 0.0125 }, { upToCents: null, rate: 0.015 }] },
      families: { baseCents: $(210_000), tiers: [{ upToCents: $(246_000), rate: 0.01 }, { upToCents: $(328_000), rate: 0.0125 }, { upToCents: null, rate: 0.015 }] },
      perChildAfterFirstCents: $(1_500),
    },
    lito: LITO,
    help: {
      marginal: [{ overCents: $(69_528), rate: 0.15 }, { overCents: $(129_717), rate: 0.17 }],
      flatFromCents: $(186_051),
      flatRate: 0.10,
    },
    super: {
      sgRate: 0.12,
      concessionalCapCents: $(32_500),
      nonConcessionalCapCents: $(130_000),
      maxContributionBaseAnnualCents: $(270_830), // annual under Payday Super from 1 Jul 2026
      contributionsTaxRate: 0.15,
    },
    sources: [
      { item: 'Resident brackets (15% / 30% / 37% / 45%)', url: ATO_RATES, checked: CHECKED, status: 'verified', note: '16% → 15% from 1 Jul 2026; $51,370 base at $190k matches.' },
      { item: 'Medicare levy 2%', url: ATO_ML_LOW, checked: CHECKED, status: 'verified' },
      { item: 'Medicare low-income threshold', url: ATO_ML_LOW, checked: CHECKED, status: 'unverified', note: '2026-27 figure not yet published; 2025-26 value carried forward. Irrelevant at household incomes.' },
      { item: 'MLS thresholds $105k / $123k / $164k single; $210k / $246k / $328k family', url: ATO_MLS, checked: CHECKED, status: 'verified', note: 'ATO page updated 22 Jun 2026 (via search snippet; also privatehealth.gov.au).' },
      { item: 'LITO unchanged', url: ATO_LITO, checked: CHECKED, status: 'verified' },
      { item: 'HELP marginal: $69,528 / 15% / $129,717 (base $9,028.35) / 17%, 10% flat from $186,051', url: ATO_HELP, checked: CHECKED, status: 'secondary', note: 'One H&R Block page says $67,528; most sources incl. ATO examples say $69,528. Owner has no HELP.' },
      { item: 'SG 12%, concessional cap $32,500, non-concessional $130,000, max contribution base $270,830', url: ATO_SUPER, checked: CHECKED, status: 'verified' },
    ],
  },
  {
    fy: 'FY2027-28',
    start: '2027-07-01',
    brackets: [
      { overCents: $(18_200), rate: 0.14 },
      { overCents: $(45_000), rate: 0.30 },
      { overCents: $(135_000), rate: 0.37 },
      { overCents: $(190_000), rate: 0.45 },
    ],
    medicare: { rate: 0.02, lowerCents: $(28_011), shadeInRate: 0.10 },
    mls: {
      singles:  { baseCents: $(105_000), tiers: [{ upToCents: $(123_000), rate: 0.01 }, { upToCents: $(164_000), rate: 0.0125 }, { upToCents: null, rate: 0.015 }] },
      families: { baseCents: $(210_000), tiers: [{ upToCents: $(246_000), rate: 0.01 }, { upToCents: $(328_000), rate: 0.0125 }, { upToCents: null, rate: 0.015 }] },
      perChildAfterFirstCents: $(1_500),
    },
    lito: LITO,
    help: {
      marginal: [{ overCents: $(69_528), rate: 0.15 }, { overCents: $(129_717), rate: 0.17 }],
      flatFromCents: $(186_051),
      flatRate: 0.10,
    },
    super: {
      sgRate: 0.12,
      concessionalCapCents: $(32_500),
      nonConcessionalCapCents: $(130_000),
      maxContributionBaseAnnualCents: $(270_830),
      contributionsTaxRate: 0.15,
    },
    sources: [
      { item: 'Bottom rate 14% from 1 Jul 2027', url: ATO_CUTS, checked: CHECKED, status: 'verified', note: 'Legislated second cut. Other brackets unchanged.' },
      { item: 'Working Australians Tax Offset (up to $250)', url: 'https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/working-australians-tax-offset', checked: CHECKED, status: 'unverified', note: 'NOT modelled: phase-out rules not confirmed. Worth at most $250/yr each.' },
      { item: 'MLS / HELP / Medicare thresholds and caps', url: ATO_SUPER, checked: CHECKED, status: 'unverified', note: '2026-27 values carried forward until the ATO publishes 2027-28 figures.' },
    ],
  },
]

/** FY key for a date: July–June. 2026-11-08 → FY2026-27. */
export function fyOf(date: string): FyKey {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const startYear = m >= 7 ? y : y - 1
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}` as FyKey
}

/** First calendar year of an FY key. */
export function fyStartYear(fy: FyKey): number {
  return Number(fy.slice(2, 6))
}

/**
 * The config for an FY. Years after the last entry reuse the last entry
 * (`extrapolated: true`: thresholds frozen, so later years show bracket creep);
 * years before the first reuse the first.
 */
export function taxConfigFor(fy: FyKey): { config: FyTaxConfig; extrapolated: boolean } {
  const exact = TAX_CONFIGS.find(c => c.fy === fy)
  if (exact) return { config: exact, extrapolated: false }
  const y = fyStartYear(fy)
  const first = TAX_CONFIGS[0]
  const last = TAX_CONFIGS[TAX_CONFIGS.length - 1]
  return { config: y < fyStartYear(first.fy) ? first : last, extrapolated: true }
}

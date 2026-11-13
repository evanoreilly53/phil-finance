// Australian (WA) home-buying rules, as DATA. Dated and versioned like the tax
// config: a rule set applies from its `from` date (contract / agreement date),
// so a future change is one new entry, and past dates keep their old rules.
//
// All money is integer cents. Rates per $100 are dollars per $100 "or part"
// (RevenueWA rounds the excess UP to the next $100).
//
// Every figure carries a source and the date it was checked. Status:
//   verified   = read on the official page (RevenueWA / wa.gov.au, Landgate,
//                firsthomebuyers.gov.au, APRA) on the check date, or for the
//                ATO (which blocks direct fetches) on ato.gov.au search snippets
//   secondary  = reputable secondary source only; official page silent or unreadable
//   estimate   = no official figure exists (LMI, HEM, agent fees): indicative only
//   unverified = assumption or interpretation; confirm before relying on it
//
// Planning model, not advice. Lenders, insurers and RevenueWA decide the real numbers.

export type RuleStatus = 'verified' | 'secondary' | 'estimate' | 'unverified'
export type RuleSource = { item: string; url: string; checked: string; status: RuleStatus; note?: string }

const CHECKED = '2026-11-13'
const $ = (dollars: number) => Math.round(dollars * 100)

const URL = {
  dutyAssessment: 'https://www.wa.gov.au/organisation/department-of-treasury-and-finance/transfer-duty-assessment',
  fhorFactSheet: 'https://www.wa.gov.au/system/files/2026-08/first-home-owner-rate-fact-sheet.pdf',
  circular23: 'https://www.wa.gov.au/system/files/2026-10/circular-23.pdf',
  housingPackage: 'https://www.wa.gov.au/government/announcements/2026-27-housing-taxation-package',
  offThePlan: 'https://www.wa.gov.au/service/financial-management/taxation-and-duty/apply-the-plan-duty-concession',
  fhog: 'https://www.wa.gov.au/government/publications/fhog-fs',
  insuranceDuty: 'https://www.wa.gov.au/service/financial-management/taxation-and-duty/self-assess-and-pay-insurance-duty',
  landgate: 'https://www.landgate.wa.gov.au/siteassets/documents/land-and-property/land-transaction-hub/land-transaction-fees/final-search-and-lodgement-fees-and-survey-fees-payable-2026-27.pdf',
  scheme: 'https://firsthomebuyers.gov.au/australian-government-5-percent-deposit-scheme',
  schemeCaps: 'https://firsthomebuyers.gov.au/australian-government-5-percent-deposit-scheme/property-price-caps',
  schemeFhb: 'https://firsthomebuyers.gov.au/australian-government-5-percent-deposit-scheme/first-home-buyers',
  apraBuffer: 'https://www.apra.gov.au/news-and-publications/apra-maintains-current-macroprudential-policy-settings-highly-uncertain',
  apraDti: 'https://www.apra.gov.au/activating-debt-to-income-limits-as-a-macroprudential-policy-tool',
  atoFhss: 'https://www.ato.gov.au/individuals-and-families/super-for-individuals-and-families/super/withdrawing-and-using-your-super/early-access-to-super/first-home-super-saver-scheme',
  atoSic: 'https://www.ato.gov.au/tax-rates-and-codes/general-interest-charge-gic-and-shortfall-interest-charge-sic-rates',
  lmi1: 'https://www.homeloanexperts.com.au/lenders-mortgage-insurance/lmi-premium-rates/',
  lmi2: 'https://austax.tools/lmi-calculator-australia/',
  hem: 'https://www.yourfinanceguide.com.au/calculators/hem',
  settlement: 'https://propereasy.com.au',
  inspection: 'https://www.whatsthedamage.com.au',
}

// ── WA transfer duty ──────────────────────────────────────────────────────────

/** Marginal duty scale: `per100` dollars per $100 (or part) above `overCents`, plus `baseCents`. */
export type DutyBand = { overCents: number; baseCents: number; per100: number }

/** First home owner rate: nil up to `nilToCents`, then `per100` above it, up to `capCents` (above the cap: general rate on the whole value). */
export type FhorScale = { nilToCents: number; capCents: number; per100: number }

export type OffThePlanRule = {
  /** Contracts signed in this window (inclusive). */
  from: string
  to: string
  maxConcessionCents: number
  /** Full concession up to `fullToCents`, tapering by `taperPctPer100` per $100 above it, to `floorPct` at/after `floorFromCents`. */
  pre: { fullToCents: number; fullPct: number; taperPctPer100: number; floorFromCents: number; floorPct: number }
  under: { fullToCents: number; fullPct: number; taperPctPer100: number; floorFromCents: number; floorPct: number }
}

export type WaDutyRules = {
  from: string               // agreement (contract) date this set applies from
  general: DutyBand[]
  fhorHome: FhorScale
  fhorLand: FhorScale
  offThePlan: OffThePlanRule | null
  sources: RuleSource[]
}

const GENERAL_SCALE: DutyBand[] = [
  { overCents: 0,          baseCents: 0,          per100: 1.90 },
  { overCents: $(120_000), baseCents: $(2_280),   per100: 2.85 },
  { overCents: $(150_000), baseCents: $(3_135),   per100: 3.80 },
  { overCents: $(360_000), baseCents: $(11_115),  per100: 4.75 },
  { overCents: $(725_000), baseCents: $(28_453),  per100: 5.15 },
]

export const WA_DUTY: readonly WaDutyRules[] = [
  {
    // 21 Mar 2025 – 6 May 2026 (Metro/Peel figures; "elsewhere" was $750k at $11.89). Kept for contracts already signed.
    from: '2025-03-21',
    general: GENERAL_SCALE,
    fhorHome: { nilToCents: $(500_000), capCents: $(700_000), per100: 13.63 },
    fhorLand: { nilToCents: $(350_000), capCents: $(450_000), per100: 15.39 },
    offThePlan: null,
    sources: [
      { item: 'FHOR homes (Metro/Peel) $500k nil, $13.63/$100 to $700k; land $350k nil, $15.39/$100 to $450k', url: URL.fhorFactSheet, checked: CHECKED, status: 'verified', note: 'Previous thresholds listed in the RevenueWA fact sheet. Outside Metro/Peel the cap was $750k at $11.89 (not modelled).' },
    ],
  },
  {
    from: '2026-05-07',
    general: GENERAL_SCALE,
    fhorHome: { nilToCents: $(600_000), capCents: $(800_000), per100: 16.15 },
    fhorLand: { nilToCents: $(450_000), capCents: $(550_000), per100: 20.14 },
    offThePlan: {
      from: '2026-03-12',
      to: '2028-06-30',
      maxConcessionCents: $(50_000),
      pre:   { fullToCents: $(800_000), fullPct: 100, taperPctPer100: 0.05,   floorFromCents: $(900_000), floorPct: 50 },
      under: { fullToCents: $(800_000), fullPct: 75,  taperPctPer100: 0.0375, floorFromCents: $(900_000), floorPct: 37.5 },
    },
    sources: [
      { item: 'General rate scale (1.90 / 2.85 / 3.80 / 4.75 / 5.15 per $100; bases $2,280 / $3,135 / $11,115 / $28,453)', url: URL.dutyAssessment, checked: CHECKED, status: 'verified', note: 'Page updated 30 Jul 2026. Check: $850,000 → $34,890.50 (RevenueWA off-the-plan example); $1,000,000 → $42,615.50.' },
      { item: 'First home owner rate, homes: nil to $600,000; $16.15 per $100 above $600,000 up to $800,000', url: URL.fhorFactSheet, checked: CHECKED, status: 'verified', note: 'Agreements on or after 7 May 2026 (agreement date, not settlement). Metro/Peel split removed. Also Circular 23 and the 2026-27 Housing Taxation Package page.' },
      { item: 'First home owner rate, vacant land: nil to $450,000; $20.14 per $100 above $450,000 up to $550,000', url: URL.fhorFactSheet, checked: CHECKED, status: 'verified' },
      { item: 'Legislation in force', url: URL.circular23, checked: CHECKED, status: 'unverified', note: 'RevenueWA says the Duties Act was amended and the changes "have now been applied"; royal-assent date not found.' },
      { item: 'Off-the-plan concession: contracts 12 Mar 2026 – 30 Jun 2028, cap $50,000; pre-construction 100% to $800k tapering 0.05%/$100 to 50% at $900k; under construction 75% → 37.5%', url: URL.offThePlan, checked: CHECKED, status: 'verified', note: 'Not limited to first home buyers.' },
      { item: 'Off-the-plan vs first home owner rate: the app uses whichever gives less duty', url: URL.offThePlan, checked: CHECKED, status: 'unverified', note: 'How RevenueWA combines the two was not confirmed. Check with your settlement agent.' },
      { item: 'Foreign transfer duty 7% (not modelled: not relevant to the household)', url: URL.fhorFactSheet, checked: CHECKED, status: 'verified' },
    ],
  },
]

// ── WA First Home Owner Grant ─────────────────────────────────────────────────

export type FhogRules = {
  from: string
  amountCents: number
  /** Total value cap for Perth / south of the 26th parallel. */
  capSouthCents: number
  capNorthCents: number
  /** Only new homes: buying a new home, building, owner-builder, substantial renovation. */
  newHomesOnly: true
  sources: RuleSource[]
}

export const WA_FHOG: readonly FhogRules[] = [
  {
    from: '2025-03-21',
    amountCents: $(10_000), capSouthCents: $(750_000), capNorthCents: $(1_000_000), newHomesOnly: true,
    sources: [{ item: 'FHOG $10,000, cap $750,000 south of 26th parallel', url: URL.fhog, checked: CHECKED, status: 'verified', note: 'Previous cap, for transactions before 7 May 2026.' }],
  },
  {
    from: '2026-05-07',
    amountCents: $(10_000), capSouthCents: $(800_000), capNorthCents: $(1_000_000), newHomesOnly: true,
    sources: [
      { item: 'FHOG $10,000, no income/asset test; cap $800,000 south of the 26th parallel (all of Perth), $1,000,000 north', url: URL.fhog, checked: CHECKED, status: 'verified', note: 'Commencement date on/after 7 May 2026. Fact sheet updated 29 Jul 2026.' },
      { item: 'New homes only: new home purchase, comprehensive building contract, owner-builder, substantially renovated; not established homes', url: URL.fhog, checked: CHECKED, status: 'verified', note: 'Off-the-plan counts as buying a new home (inference: the page doesn\'t use the words "off the plan").' },
      { item: 'Live in it as your main home for 6 continuous months, starting within 12 months of completion', url: URL.fhog, checked: CHECKED, status: 'verified' },
    ],
  },
]

// ── 5% Deposit Scheme (Australian Government, Housing Australia) ─────────────

export type DepositSchemeRules = {
  from: string
  minDepositPct: number
  /** Price caps by area. */
  capPerthCents: number
  capRestOfWaCents: number
  incomeCap: null
  placeCap: null
  /** Guarantee covers up to this % of the price (so no LMI). */
  guaranteePct: number
  maxTermYears: number
  sources: RuleSource[]
}

export const DEPOSIT_SCHEME: readonly DepositSchemeRules[] = [
  {
    from: '2025-10-01',
    minDepositPct: 5,
    capPerthCents: $(850_000),
    capRestOfWaCents: $(600_000),
    incomeCap: null,
    placeCap: null,
    guaranteePct: 15,
    maxTermYears: 30,
    sources: [
      { item: 'From 1 Oct 2025: no income caps, unlimited places, no LMI, 5% minimum deposit', url: URL.scheme, checked: CHECKED, status: 'verified' },
      { item: 'WA price caps: $850,000 Perth and regional centres; $600,000 rest of WA', url: URL.schemeCaps, checked: CHECKED, status: 'verified', note: 'The caps page shows no effective date.' },
      { item: 'Eligibility: citizen/PR, 18+, first home buyer or no property in Australia in the last 10 years, owner-occupier, P&I loan up to 30 years, participating lender, sign within 90 days of pre-approval', url: URL.schemeFhb, checked: CHECKED, status: 'verified' },
      { item: 'Guarantee up to 15% of the price', url: URL.scheme, checked: CHECKED, status: 'secondary', note: 'From a Housing Australia media release seen in search results; the scheme pages don\'t state the %.' },
    ],
  },
]

// ── Lenders mortgage insurance (indicative) ──────────────────────────────────

/** LMI premium as % of the loan, by LVR band (upper bound inclusive). ESTIMATE: real premiums vary by insurer, lender and loan size. */
export type LmiBand = { lvrToPct: number; premiumPct: number }

export const LMI_ESTIMATE = {
  bands: [
    { lvrToPct: 80, premiumPct: 0 },
    { lvrToPct: 85, premiumPct: 1.1 },
    { lvrToPct: 90, premiumPct: 2.0 },
    { lvrToPct: 95, premiumPct: 3.6 },
  ] satisfies LmiBand[],
  /** Loans above this size usually attract higher premiums: +15% on the premium rate here. */
  largeLoanFromCents: $(750_000),
  largeLoanLoading: 1.15,
  /** WA insurance duty on general insurance premiums. */
  stampDutyPct: 10,
  sources: [
    { item: 'Indicative LMI premiums: 80–85% LVR 0.83–1.24%; 85–90% 1.5–2.3%; 90–95% 2.9–4.0% of the loan (loans ~$500k–$650k)', url: URL.lmi1, checked: CHECKED, status: 'estimate', note: 'Also austax.tools. App uses the middle of each range, +15% for loans over $750k. Real quotes vary by insurer (Helia, QBE) and lender.' },
    { item: 'WA insurance duty 10% on general insurance premiums', url: URL.insuranceDuty, checked: CHECKED, status: 'unverified', note: 'The 10% duty is official; LMI is not on the exemption list, but the page doesn\'t name LMI explicitly.' },
  ] satisfies RuleSource[],
} as const

// ── Other purchase costs ──────────────────────────────────────────────────────

/** Landgate transfer registration fee: stepped by value. */
export const LANDGATE_2026_27 = {
  from: '2026-07-01',
  transferBands: [
    { toCents: $(85_000), feeCents: $(225.10) },
    { toCents: $(120_000), feeCents: $(235.10) },
    { toCents: $(200_000), feeCents: $(255.10) },
  ],
  /** Above $200k: +$20 per further $100,000 (or part), to $2M; then the same step continues. */
  stepPer100kCents: $(20),
  mortgageRegistrationCents: $(225.10),
  sources: [
    { item: 'Landgate 2026-27: mortgage registration $225.10; transfer $225.10 to $85k, $235.10 to $120k, $255.10 to $200k, +$20 per $100k band ($415.10 at $900,001–$1M)', url: URL.landgate, checked: CHECKED, status: 'verified', note: 'Fees as at 1 Jul 2026.' },
  ] satisfies RuleSource[],
}

export const OTHER_COSTS_ESTIMATE = {
  settlementAgentCents: $(2_200),
  buildingPestCents: $(650),
  sources: [
    { item: 'Settlement agent: typically $1,800–$3,500 all-in (app uses $2,200)', url: URL.settlement, checked: CHECKED, status: 'estimate' },
    { item: 'Building and pest inspection, Perth: $450–$900 for a standard house (app uses $650)', url: URL.inspection, checked: CHECKED, status: 'estimate' },
  ] satisfies RuleSource[],
}

// ── Serviceability (APRA) and living-expense floor ───────────────────────────

export const SERVICEABILITY = {
  from: '2026-05-28',
  bufferPctPoints: 3,
  /** DTI ≥ 6 is limited to 20% of each bank's new owner-occupier lending (not a per-borrower ban). */
  dtiFlag: 6,
  dtiShareLimitPct: 20,
  /** HEM-style floor for a couple with no dependants, ~$200k gross. APPROXIMATE (the Melbourne Institute table isn't public). */
  hemCoupleMonthlyCents: $(3_760),
  sources: [
    { item: 'APRA serviceability buffer 3 percentage points (unchanged 28 May 2026)', url: URL.apraBuffer, checked: CHECKED, status: 'verified', note: 'No later change found; anything after May 2026 is unverified.' },
    { item: 'DTI limit from 1 Feb 2026: each bank may write at most 20% of new lending at DTI ≥ 6 (owner-occupier and investor separately; new builds exempt)', url: URL.apraDti, checked: CHECKED, status: 'verified' },
    { item: 'HEM-style living-expense floor ~$3,760/month (couple, no dependants, $200k gross)', url: URL.hem, checked: CHECKED, status: 'estimate', note: 'Third-party re-pricing of ABS data to June 2026; real HEM is licensed and varies by lender, income and postcode. Treat $3,500–$4,000 as the range.' },
  ] satisfies RuleSource[],
}

// ── First Home Super Saver (ATO) ─────────────────────────────────────────────

export const FHSS = {
  perFyCapCents: $(15_000),
  lifetimeCapCents: $(50_000),
  concessionalReleasePct: 85,
  nonConcessionalReleasePct: 100,
  releaseOffsetPct: 30,
  /** Withheld if the ATO can't estimate your marginal rate. */
  defaultWithholdingPct: 17,
  /** Tax if you neither buy nor recontribute. */
  failToBuyTaxPct: 20,
  /** Shortfall interest charge rate used for deemed earnings, Oct–Dec 2026. */
  sicRatePct: 7.51,
  sicQuarter: 'Oct–Dec 2026',
  /** Sign a contract from 90 days before the release request to 12 months after it (extendable by 12). */
  signWindowBeforeDays: 90,
  signWindowAfterMonths: 12,
  notifyWithinDays: 90,
  releaseBusinessDays: '15–20',
  sources: [
    { item: 'Counted voluntary contributions: $15,000 per FY, $50,000 in total per person', url: URL.atoFhss, checked: CHECKED, status: 'verified', note: 'ATO search snippets (direct fetch blocked).' },
    { item: 'Releasable: 85% of concessional + 100% of non-concessional + deemed earnings at the shortfall interest charge rate', url: URL.atoFhss, checked: CHECKED, status: 'verified', note: 'ATO snippets. The app compounds deemed earnings monthly on the full contributed amount: approximate.' },
    { item: 'Released amount taxed at marginal rate (incl. Medicare) less a 30% non-refundable offset; ATO withholds (17% if it can\'t estimate)', url: URL.atoFhss, checked: CHECKED, status: 'verified', note: 'ATO snippets.' },
    { item: 'Request a determination before ownership transfers; sign a contract from 90 days before the release request to 12 months after it; notify the ATO within 90 days of signing', url: URL.atoFhss, checked: CHECKED, status: 'verified', note: 'Rules for determinations from 15 Sep 2024 (were 14 / 28 days). Release takes about 15–20 business days.' },
    { item: 'Shortfall interest charge 7.51% p.a. (Oct–Dec 2026)', url: URL.atoSic, checked: CHECKED, status: 'secondary', note: 'Secondary source; consistent with the ATO GIC of 11.51% (SIC = GIC − 4). Changes quarterly.' },
  ] satisfies RuleSource[],
}

// ── Lookup ────────────────────────────────────────────────────────────────────

/** The entry in force on `date` (latest `from` ≤ date); before the first, the first. */
export function ruleFor<T extends { from: string }>(rules: readonly T[], date: string): T {
  let pick = rules[0]
  for (const r of rules) if (r.from <= date && r.from >= pick.from) pick = r
  return pick
}

/** Every source note, for the "Where these numbers come from" list. */
export function allHouseSources(date: string): RuleSource[] {
  return [
    ...ruleFor(WA_DUTY, date).sources,
    ...ruleFor(WA_FHOG, date).sources,
    ...ruleFor(DEPOSIT_SCHEME, date).sources,
    ...LMI_ESTIMATE.sources,
    ...LANDGATE_2026_27.sources,
    ...OTHER_COSTS_ESTIMATE.sources,
    ...SERVICEABILITY.sources,
    ...FHSS.sources,
  ]
}

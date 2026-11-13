// Types for the monthly projection engine. All money is integer AUD cents
// unless a field says otherwise (planned cashflows keep their native currency).

import type { AccountType } from '../supabase/database.types'
import type { AssumptionKey } from '../assumptions'
import type { FyKey } from '../tax/config'
import type { PropertyKind } from '../house/duty'

export type Assumptions = Record<AssumptionKey, number>

export type Indexation = 'none' | 'inflation' | 'wages' | 'custom'
export type Frequency = 'once' | 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'

export type ProjAccount = {
  id: string
  name: string
  type: AccountType
  owner: string               // 'joint' | person key
  isLiquid: boolean
  currency: string
  balanceCents: number        // AUD, latest known (debts negative)
  balanceAsOf: string | null
  interestRatePct: number | null
  expectedReturnPct: number | null
  feePct: number | null
  annualFeeCents: number | null
  loan: {
    repaymentCents: number | null
    repaymentFreq: 'weekly' | 'fortnightly' | 'monthly' | null
    startDate: string | null
    termMonths: number | null
    interestOnly: boolean
    offsetAccountId: string | null
  } | null
  synthetic?: boolean         // created by the engine (house, mortgage, unallocated cash)
}

export type ProjPerson = { key: string; name: string; hasPrivateHospital: boolean; hasHecs: boolean }

/** A gross salary handled by the tax engine. */
export type Salary = {
  id: string
  personKey: string
  description: string
  grossAnnualCents: number    // at start, before indexation
  startDate: string
  endDate: string | null
  indexation: Indexation
  indexationPct: number | null
}

/** A person's take-home pay entered net (Settings), used only when they have no gross salary. */
export type NetIncome = { personKey: string | null; label: string; monthlyNetCents: number; source: string }

export type ProjCashflow = {
  id: string
  description: string
  kind: 'income' | 'expense' | 'transfer' | 'super_contribution'
  personKey: string | null
  amountCents: number         // native currency, per occurrence (sign ignored: kind decides direction)
  currency: string
  frequency: Frequency
  startDate: string
  endDate: string | null
  indexation: Indexation
  indexationPct: number | null
  accountId: string | null
  toAccountId: string | null
  eventId: string | null
  /** A voluntary concessional contribution (Track › Income › Super cap): counts toward the cap. */
  concessional?: boolean
}

/** Phase 5: voluntary pre-tax salary sacrifice to super, per person (a yearly amount). */
export type SacrificePlan = { personKey: string; annualCents: number }

/**
 * Phase 5: First Home Super Saver in the projection. Salary sacrifice made
 * before `requestMonth` counts toward FHSS (within the yearly and lifetime
 * limits); deemed earnings accrue to then; the release (less withdrawal tax)
 * lands in the savings account in `releaseMonth`.
 */
export type FhssPlan = { requestMonth: string; releaseMonth: string; sicRatePct?: number }

export type FhssRelease = {
  personKey: string
  name: string
  month: string
  countedCents: number
  /** 85% of counted contributions. */
  releasableContribCents: number
  deemedEarningsCents: number
  releasedCents: number
  taxCents: number
  netCents: number
}

export type HouseParams = {
  priceCents: number
  /** Total cash needed at purchase: deposit + duty + costs. */
  upfrontCents: number
  /** Duty + fees + LMI − grants inside upfrontCents (lost to net worth). Can be negative (grant > costs). */
  costsCents: number
  /** 'calculated' = WA duty/fees/LMI/FHOG calculator; 'entered' = typed in by you. */
  costsSource: 'calculated' | 'entered'
  loanTermMonths: number
  /** Rent that stops once you move in (optional). */
  rentMonthlyCents: number
  firstHome: boolean
  propertyKind: PropertyKind
  /** Use the 5% Deposit Scheme if eligible (no LMI). */
  useScheme: boolean
  /** An existing cash account that becomes the mortgage offset after purchase. */
  offsetAccountId: string | null
  /** Paid on top of the scheduled repayment each month. */
  extraRepaymentMonthlyCents: number
}

export type LeaveParams = {
  personKey: string
  /** Share of normal pay received while on leave (0 = unpaid). */
  payPct: number
  /** Last day of the leave (inclusive). */
  endDate: string
}

export type ProjEvent = {
  id: string
  name: string
  kind: string
  date: string
  status: 'planned' | 'done' | 'cancelled'
  house: HouseParams | null
  leave?: LeaveParams | null
}

export type SpendingLine = {
  key: string                 // category id or 'uncategorised'
  name: string
  monthlyCents: number        // what the projection uses
  averageCents: number        // recent average (positive = spending)
  budgetCents: number | null
  basis: 'budget' | 'average' | 'excluded'
}

export type SpendingBaseline = {
  lines: SpendingLine[]
  totalMonthlyCents: number
  months: string[]            // the complete months averaged
}

export type ProjectionInput = {
  today: string               // YYYY-MM-DD (Perth)
  startMonth: string          // first projected month, YYYY-MM
  months: number
  assumptions: Assumptions
  accounts: ProjAccount[]
  people: ProjPerson[]
  salaries: Salary[]
  netIncomes: NetIncome[]
  spending: SpendingBaseline
  cashflows: ProjCashflow[]
  events: ProjEvent[]
  /** AUD per 1 unit of foreign currency. */
  fx: Record<string, number>
  /** Where surplus/shortfall lands. Null → an "Unallocated cash" account is created. */
  sweepAccountId: string | null
  /** Accounts that count toward the house deposit (the sweep account always does). */
  depositAccountIds: string[]
  /** Back-solver lever: extra saving per month into the sweep account. */
  extraMonthlyCents?: number
  /** e.g. ['house_purchase'] to ask "when would we reach the deposit?" */
  excludeEventKinds?: string[]
  /** Phase 5: salary sacrifice per person (reduces taxable pay; taxed 15% into super). */
  sacrifice?: SacrificePlan[]
  /** Phase 5: release FHSS-counted sacrifice for the house (null/absent = FHSS off). */
  fhss?: FhssPlan | null
}

export type TraceKind =
  | 'income' | 'tax' | 'super' | 'spending' | 'planned' | 'event'
  | 'interest' | 'growth' | 'fees' | 'loan' | 'transfer' | 'extra' | 'fhss'

export type TraceEntry = {
  kind: TraceKind
  label: string
  /** Amount as it hit `accountId` (+ in, − out). Memo lines (tax, gross pay) have no account. */
  cents: number
  /** Effect on net worth (0 for moves between your own accounts). */
  nwCents: number
  accountId?: string
  ref?: { table: 'planned_cashflows' | 'life_events' | 'accounts' | 'salary' | 'net_income' | 'spending'; id: string }
  detail?: string
  memo?: boolean
  /** The receiving side of a move between your own accounts (the paying side carries the label). */
  inLeg?: boolean
}

export type CashflowSummary = {
  grossPayCents: number
  taxCents: number
  takeHomeCents: number
  otherIncomeCents: number
  superInCents: number
  spendingCents: number
  plannedOutCents: number
  loanRepaymentCents: number
  loanInterestCents: number
  interestCents: number
  investmentGrowthCents: number
  superGrowthCents: number
  propertyGrowthCents: number
  eventCostsCents: number
  extraCents: number
  /** Gross pay salary-sacrificed to super this month (already out of take-home). */
  sacrificeCents: number
  /** FHSS money released into cash this month, after withdrawal tax. */
  fhssReleaseCents: number
  /** Cash left over after everything paid in cash (take-home + other income − spending − planned − repayments + extra). */
  netCashCents: number
}

export type MonthTotals = {
  netWorthCents: number
  liquidCents: number
  superCents: number
  investmentsCents: number
  propertyCents: number
  debtCents: number
  depositPotCents: number
}

export type ProjectionMonth = MonthTotals & {
  month: string               // YYYY-MM
  fy: FyKey
  balances: Record<string, number>
  cashflow: CashflowSummary
  trace: TraceEntry[]
  pins: { id: string; name: string; kind: string }[]
}

export type Projection = {
  startMonth: string
  opening: MonthTotals & { balances: Record<string, number> }
  months: ProjectionMonth[]
  accounts: ProjAccount[]     // incl. synthetic ones
  sweepAccountId: string
  depositAccountIds: string[]
  warnings: string[]
  /** FYs where tax settings were carried forward from the last known year. */
  extrapolatedFys: FyKey[]
  /** Phase 5: FHSS releases modelled (one per person with counted contributions). */
  fhss: FhssRelease[]
}

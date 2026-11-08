// Types for the monthly projection engine. All money is integer AUD cents
// unless a field says otherwise (planned cashflows keep their native currency).

import type { AccountType } from '../supabase/database.types'
import type { AssumptionKey } from '../assumptions'
import type { FyKey } from '../tax/config'

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
}

export type HouseParams = {
  priceCents: number
  /** Total cash needed at purchase: deposit + duty + costs. */
  upfrontCents: number
  /** Duty + fees inside upfrontCents (lost to net worth). Placeholder until Phase 3. */
  costsCents: number
  costsIsPlaceholder: boolean
  loanTermMonths: number
  /** Rent that stops once you move in (optional). */
  rentMonthlyCents: number
}

export type ProjEvent = {
  id: string
  name: string
  kind: string
  date: string
  status: 'planned' | 'done' | 'cancelled'
  house: HouseParams | null
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
}

export type TraceKind =
  | 'income' | 'tax' | 'super' | 'spending' | 'planned' | 'event'
  | 'interest' | 'growth' | 'fees' | 'loan' | 'transfer' | 'extra'

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
}

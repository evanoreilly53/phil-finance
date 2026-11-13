// Insights engine types. Every rule is a pure function of an InsightContext
// that returns zero or more candidate insights. Money is integer AUD cents.

import type { BudgetRow } from '../budgets'
import type { CategoryKind, AccountType } from '../supabase/database.types'
import type { PropertyKind } from '../house/duty'
import type { Subscription } from '../subscriptions/detect'
import type { SubscriptionMark } from '../subscriptions/bills'

export type RuleId =
  | 'goal_drift' | 'idle_cash' | 'fhss_window' | 'cap_headroom' | 'subscriptions'
  | 'category_spike' | 'budget_overrun' | 'lifestyle_creep' | 'price_cliff'
  | 'fx_fees' | 'eur_exposure' | 'stale_data' | 'uncategorised'

export type Evidence =
  | { kind: 'tx'; id: string; date: string; description: string; cents: number; currency?: string; nativeCents?: number }
  | { kind: 'row'; label: string; value: string }

/** How acting on an insight would change cash toward the deposit. Fed to the projection engine. */
export type DepositEffect =
  | { monthlyCents: number }
  | { oneOffCents: number }
  /** Phase 5: extra yearly salary sacrifice per person, counted toward FHSS and released for the house. */
  | { sacrifice: { personKey: string; annualCents: number }[]; fhss: { requestMonth: string; releaseMonth: string } }

export type Insight = {
  /** Stable key: Done / Snooze / "That's intentional" attach to it. */
  key: string
  rule: RuleId
  title: string
  detail: string
  /** The $ figure the card is about, used for ranking (≥ 0). Annual for ongoing items, one-off otherwise. */
  impactCents: number
  impactLabel: string
  depositEffect: DepositEffect | null
  /** Why there's no "days sooner" figure, when depositEffect is null. */
  depositNote?: string
  /** Days sooner (+) or later (−) the deposit is reached; filled in by attachDepositDays. */
  depositDays?: number | null
  evidence: Evidence[]
  href?: string
  hrefLabel?: string
  /** End-of-financial-year items: ranked first from April to June. */
  timeSensitive?: boolean
  /** Candidates in the same group are deduplicated (largest impact wins). */
  group?: string
}

export type InsightTx = {
  id: string
  date: string
  description: string
  aud_amount_cents: number
  amount_cents?: number
  currency?: string
  category_id: string | null
  is_transfer: boolean | null
  account_id?: string | null
}

export type InsightCategory = { id: string; name: string; parent_id: string | null; kind: CategoryKind | null }

export type InsightAccount = {
  id: string
  name: string
  type: AccountType
  currency: string
  balanceCents: number
  balanceAsOf: string | null
  interestRatePct: number | null
  dataAsOf: string | null
}

export type InsightPerson = {
  key: string
  name: string
  grossCents: number
  hasPrivateHospital: boolean
  hasHecs: boolean
  /** Voluntary concessional contributions entered for this FY (Track › Income). */
  voluntaryConcessionalCents: number
}

export type DepositSnapshot = {
  eventId: string | null
  eventName: string
  /** 'now', 'YYYY-MM', or null (not reached within the projection). */
  projectedMonth: string | null
  byMonth: string
  monthsLate: number | null
  extraMonthlyCents: number | null
  targetCents: number
}

export type InsightContext = {
  today: string
  thisMonth: string
  /** Transactions from roughly the last 25 months (transfers included; rules exclude them). */
  transactions: InsightTx[]
  categories: InsightCategory[]
  budgets: BudgetRow[]
  accounts: InsightAccount[]
  /** The savings-interest rate the projection assumes (%). */
  cashRatePct: number
  /** Monthly spending the projection uses (the buffer for idle cash). */
  monthlySpendCents: number
  deposit: DepositSnapshot | null
  /** Last month's check-in record (goal drift). */
  previousCheckin: { month: string; depositProjectedMonth: string | null } | null
  house: { eventName: string; date: string; priceCents: number; cashCents: number; firstHome: boolean; kind: PropertyKind; useScheme: boolean } | null
  people: InsightPerson[]
  /** When FHSS money would be released for the house (House › FHSS timeline). */
  fhssReleaseMonth: string | null
  /** Phase 5: the projection's FHSS months for the house (request, money lands); null without a future first-home plan. */
  fhssMonths?: { requestMonth: string; releaseMonth: string } | null
  /** Phase 5: FHSS is already switched on in the plan. */
  fhssOn?: boolean
  subscriptions: Subscription[]
  subscriptionMarks: SubscriptionMark[]
  /** Future planned outflows in EUR (still to pay). */
  plannedEur: { description: string; nativeCents: number; date: string }[]
  eurAudRate: number
}

export type InsightStateRow = {
  key: string
  state: 'done' | 'snoozed' | 'intentional' | 'tracked' | 'dismissed'
  done_month: string | null
  snooze_until: string | null
}

// Turning stored rows into projection inputs. Pure (no Supabase here), so the
// rules about what counts, and what is skipped and why, are unit-tested.

import { budgetsForMonth, rootCategoryId, spendByCategory, UNCATEGORISED, type BudgetRow, type CategoryNode, type SpendTx } from '../budgets'
import { CASH_TYPES, INVEST_TYPES } from './engine'
import { OCCURRENCES_PER_YEAR } from './schedule'
import { isPropertyKind, type PropertyKind } from '../house/duty'
import { purchase } from '../house/purchase'
import type { Frequency, HouseParams, Indexation, LeaveParams, ProjAccount, ProjCashflow, Salary, SpendingBaseline, SpendingLine } from './types'

// ── Spending baseline ─────────────────────────────────────────────────────────

/** Category names left out of the baseline because planned items model them. */
export const BASELINE_EXCLUDE = /wedding|one[- ]?off/i

export function spendingBaseline(p: {
  txs: readonly SpendTx[]
  categories: readonly (CategoryNode & { name: string })[]
  budgets: readonly BudgetRow[]
  /** Complete months to average, oldest first. */
  months: readonly string[]
  /** Month whose budget targets apply. */
  budgetMonth: string
  /** Top-level categories to leave out (e.g. Wedding, Large One-Off). */
  excludeRootIds?: ReadonlySet<string>
}): SpendingBaseline {
  const byId = new Map(p.categories.map(c => [c.id, c]))
  const sums = new Map<string, number>()
  for (const mk of p.months) {
    for (const [key, cents] of spendByCategory(p.txs, mk, p.categories)) {
      // Money moved into investments ("savings" kind) isn't spending.
      if (key !== UNCATEGORISED && byId.get(key)?.kind === 'savings') continue
      const root = key === UNCATEGORISED ? key : rootCategoryId(key, byId)
      if (root !== UNCATEGORISED && byId.get(root)?.kind === 'savings') continue
      sums.set(root, (sums.get(root) ?? 0) + cents)
    }
  }
  const targets = budgetsForMonth(p.budgets, p.budgetMonth)
  const n = Math.max(1, p.months.length)
  const keys = new Set([...sums.keys(), ...[...targets.keys()].filter(k => !byId.get(k)?.parent_id)])

  const lines: SpendingLine[] = [...keys].map((key): SpendingLine => {
    const cat = byId.get(key)
    const averageCents = Math.max(0, Math.round((sums.get(key) ?? 0) / n))
    const budget = targets.get(key)
    const budgetCents = budget && budget > 0 ? budget : null
    if (p.excludeRootIds?.has(key)) return { key, name: cat?.name ?? key, monthlyCents: 0, averageCents, budgetCents, basis: 'excluded' }
    if (cat && (cat.kind === 'income' || cat.kind === 'transfer' || cat.kind === 'savings')) return { key, name: cat.name, monthlyCents: 0, averageCents, budgetCents, basis: 'excluded' }
    return budgetCents !== null
      ? { key, name: cat?.name ?? key, monthlyCents: budgetCents, averageCents, budgetCents, basis: 'budget' }
      : { key, name: key === UNCATEGORISED ? 'Uncategorised' : cat?.name ?? key, monthlyCents: averageCents, averageCents, budgetCents: null, basis: 'average' }
  }).sort((x, y) => y.monthlyCents - x.monthlyCents || x.name.localeCompare(y.name))

  return { lines, totalMonthlyCents: lines.reduce((s, l) => s + l.monthlyCents, 0), months: [...p.months] }
}

// ── Planned cashflows → salaries / cashflows / skipped ────────────────────────

export type CashflowRow = {
  id: string
  description: string
  kind: 'income' | 'expense' | 'transfer' | 'super_contribution'
  person_key: string | null
  amount_cents: number
  currency: string
  is_gross: boolean
  frequency: Frequency
  start_date: string
  end_date: string | null
  indexation: Indexation
  indexation_pct: number | null
  account_id: string | null
  to_account_id: string | null
  event_id: string | null
  status: 'planned' | 'paid' | 'cancelled'
  source_table: string | null
  scenario_id: string | null
}

export type Skipped = { id: string; description: string; reason: string }

export function selectCashflows(rows: readonly CashflowRow[], opts: { today: string; scenarioId: string | null; /** The scenario and its ancestors (a fork sees its parents' items). */ scenarioIds?: ReadonlySet<string>; cancelledEventIds?: ReadonlySet<string> }):
  { salaries: Salary[]; cashflows: ProjCashflow[]; skipped: Skipped[] } {
  const salaries: Salary[] = []
  const cashflows: ProjCashflow[] = []
  const skipped: Skipped[] = []
  for (const r of rows) {
    if (r.status !== 'planned') continue
    if (r.scenario_id && !(opts.scenarioIds ? opts.scenarioIds.has(r.scenario_id) : r.scenario_id === opts.scenarioId)) continue
    if (r.event_id && opts.cancelledEventIds?.has(r.event_id)) continue
    if (r.end_date && r.end_date < opts.today) continue

    if (r.kind === 'income' && r.is_gross && r.frequency !== 'once') {
      if (!r.person_key) { skipped.push({ id: r.id, description: r.description, reason: 'Gross salary with no person, so tax can’t be worked out' }); continue }
      salaries.push({
        id: r.id, personKey: r.person_key, description: r.description,
        grossAnnualCents: Math.abs(r.amount_cents) * OCCURRENCES_PER_YEAR[r.frequency],
        startDate: r.start_date, endDate: r.end_date,
        indexation: r.indexation, indexationPct: r.indexation_pct,
      })
      continue
    }
    if (r.source_table === 'recurring_transactions' && r.frequency !== 'once' && !r.event_id) {
      skipped.push({ id: r.id, description: r.description, reason: 'Recurring item copied from Settings: already counted in your recent spending or pay' })
      continue
    }
    if (r.frequency === 'once' && r.start_date < opts.today) {
      skipped.push({ id: r.id, description: r.description, reason: `Dated ${r.start_date} but not marked paid: mark it paid or give it a new date` })
      continue
    }
    cashflows.push({
      id: r.id, description: r.description, kind: r.kind, personKey: r.person_key,
      amountCents: r.amount_cents, currency: r.currency, frequency: r.frequency,
      startDate: r.start_date, endDate: r.end_date, indexation: r.indexation, indexationPct: r.indexation_pct,
      accountId: r.account_id, toAccountId: r.to_account_id, eventId: r.event_id,
    })
  }
  return { salaries, cashflows, skipped }
}

// ── House purchase params (life_events.params jsonb) ──────────────────────────

export const DEFAULT_LOAN_TERM_MONTHS = 360

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** The purchase-calculator settings stored in a house event's params. */
export function houseSettings(params: unknown) {
  const o = obj(params)
  return {
    firstHome: o.first_home_buyer !== false,
    propertyKind: isPropertyKind(o.property_kind) ? o.property_kind : o.new_build === true ? 'new' as const : 'established' as const,
    useScheme: o.use_deposit_scheme === true,
    offsetAccountId: typeof o.offset_account_id === 'string' && o.offset_account_id ? o.offset_account_id : null,
    extraRepaymentMonthlyCents: Math.max(0, Math.round(num(o.extra_repayment_monthly_cents) ?? 0)),
  }
}

/**
 * House event params → engine params. Duty, fees, LMI and FHOG come from the
 * WA purchase calculator (contract date = the event date) unless you've typed
 * your own figure in `upfront_costs_cents`.
 */
export function houseParams(params: unknown, budgetCents: number | null, eventDate?: string): HouseParams | null {
  const o = obj(params)
  const price = num(o.price_cents)
  if (!price || price <= 0) return null
  const upfront = Math.max(0, Math.round(num(o.deposit_cents) ?? budgetCents ?? Math.round(price * 0.25)))
  const entered = num(o.upfront_costs_cents)
  const s = houseSettings(o)
  const costs = entered !== null ? Math.max(0, Math.round(entered)) : purchase({
    priceCents: Math.round(price), cashCents: upfront, firstHome: s.firstHome, kind: s.propertyKind,
    contractDate: eventDate ?? '9999-12-31', useScheme: s.useScheme,
  }).costsCents
  return {
    priceCents: Math.round(price),
    upfrontCents: upfront,
    costsCents: costs,
    costsSource: entered !== null ? 'entered' : 'calculated',
    loanTermMonths: Math.max(12, Math.min(600, Math.round(num(o.loan_term_months) ?? DEFAULT_LOAN_TERM_MONTHS))),
    rentMonthlyCents: Math.max(0, Math.round(num(o.rent_monthly_cents) ?? 0)),
    ...s,
  }
}

/** Leave event params → engine params (null if incomplete). */
export function leaveParams(params: unknown, endDate: string | null): LeaveParams | null {
  const o = obj(params)
  const personKey = typeof o.person_key === 'string' ? o.person_key : null
  const payPct = num(o.pay_pct) ?? 0
  if (!personKey || !endDate) return null
  return { personKey, payPct: Math.max(0, Math.min(100, payPct)), endDate }
}

export function depositAccountIdsFromParams(params: unknown): string[] | null {
  const o = params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {}
  return Array.isArray(o.deposit_account_ids) ? o.deposit_account_ids.filter((x): x is string => typeof x === 'string') : null
}

// ── Which accounts collect savings / count toward the deposit ─────────────────

/** Surplus lands in the largest everyday AUD account, preferring joint ones. */
export function chooseSweepAccount(accounts: readonly ProjAccount[]): string | null {
  const cands = accounts.filter(a => CASH_TYPES.has(a.type) && a.currency === 'AUD' && a.type !== 'wedding')
  cands.sort((a, b) => Number(b.owner === 'joint') - Number(a.owner === 'joint') || b.balanceCents - a.balanceCents || a.name.localeCompare(b.name))
  return cands[0]?.id ?? null
}

/** Default deposit pot: everyday/savings accounts + investments, except equity stakes ("Business ..."). */
export function defaultDepositAccountIds(accounts: readonly Pick<ProjAccount, 'id' | 'type' | 'name'>[]): string[] {
  return accounts.filter(a => CASH_TYPES.has(a.type) || (INVEST_TYPES.has(a.type) && !/business|venture/i.test(a.name))).map(a => a.id)
}

// ── Editing the house event (Assumptions form) ───────────────────────────────

export type HouseEdit = {
  priceCents: number
  upfrontCents: number
  /** null = use the placeholder estimate */
  costsCents: number | null
  rentMonthlyCents: number
  loanTermMonths: number
  depositAccountIds: string[]
  /** Optional purchase settings (undefined = keep what's stored). */
  firstHome?: boolean
  propertyKind?: PropertyKind
  useScheme?: boolean
  offsetAccountId?: string | null
  extraRepaymentMonthlyCents?: number
}

/** Merge edits into the stored params, keeping keys the form doesn't own (state, notes...). */
export function mergeHouseParams(existing: unknown, edit: HouseEdit): Record<string, unknown> {
  const base = { ...obj(existing) }
  base.price_cents = edit.priceCents
  base.deposit_cents = edit.upfrontCents
  if (edit.costsCents === null) delete base.upfront_costs_cents
  else base.upfront_costs_cents = edit.costsCents
  base.rent_monthly_cents = edit.rentMonthlyCents
  base.loan_term_months = edit.loanTermMonths
  base.deposit_account_ids = edit.depositAccountIds
  return mergeHouseSettings(base, edit)
}

export type HouseSettingsEdit = Pick<HouseEdit, 'firstHome' | 'propertyKind' | 'useScheme' | 'offsetAccountId' | 'extraRepaymentMonthlyCents'>

/** Merge only the purchase settings (House tab edits). */
export function mergeHouseSettings(existing: unknown, edit: HouseSettingsEdit): Record<string, unknown> {
  const base = { ...obj(existing) }
  if (edit.firstHome !== undefined) base.first_home_buyer = edit.firstHome
  if (edit.propertyKind !== undefined) { base.property_kind = edit.propertyKind; base.new_build = edit.propertyKind !== 'established' }
  if (edit.useScheme !== undefined) base.use_deposit_scheme = edit.useScheme
  if (edit.offsetAccountId !== undefined) { if (edit.offsetAccountId) base.offset_account_id = edit.offsetAccountId; else delete base.offset_account_id }
  if (edit.extraRepaymentMonthlyCents !== undefined) base.extra_repayment_monthly_cents = Math.max(0, Math.round(edit.extraRepaymentMonthlyCents))
  return base
}

export function validateHouseEdit(e: HouseEdit): string | null {
  const ok = (n: number) => Number.isSafeInteger(n) && n >= 0
  if (!ok(e.priceCents) || e.priceCents === 0) return 'Enter a price'
  if (!ok(e.upfrontCents)) return 'Enter the upfront amount'
  if (e.upfrontCents > e.priceCents) return 'Upfront cash can’t be more than the price'
  if (e.costsCents !== null && (!ok(e.costsCents) || e.costsCents > e.upfrontCents)) return 'Duty + costs must be part of the upfront amount'
  if (!ok(e.rentMonthlyCents)) return 'Rent must be zero or more'
  if (!Number.isInteger(e.loanTermMonths) || e.loanTermMonths < 12 || e.loanTermMonths > 600) return 'Loan term must be 1–50 years'
  if (e.propertyKind !== undefined && !isPropertyKind(e.propertyKind)) return 'Pick a property type'
  if (e.extraRepaymentMonthlyCents !== undefined && (!ok(e.extraRepaymentMonthlyCents) || e.extraRepaymentMonthlyCents > 10_000_000)) return 'Extra repayment must be $0–$100,000 a month'
  return null
}

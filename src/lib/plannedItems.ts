// One source of truth for planned items (Phase 3 tidy).
// Goals › Upcoming payments and Settings › Recurring now read and write
// `planned_cashflows`, the table the projection reads. The old tables
// (`planned_outflows`, `recurring_transactions`) are kept untouched as an
// archive. These pure mappers translate between the old screens' shapes and
// planned_cashflows rows.

export type RecurrenceFreq = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'

/**
 * Recurring items that are already part of your recent spending or pay (so the
 * projection must skip them, or they'd be counted twice). Items copied from the
 * old Settings › Recurring, and new ones added there with "already in our
 * spending" ticked.
 */
export const RECURRING_IN_SPENDING_SOURCES: ReadonlySet<string> = new Set(['recurring_transactions', 'settings_recurring', 'detected_subscription'])

/** source_table for a subscription found in your transactions and tracked from the Bills view (Phase 4). */
export const DETECTED_SUBSCRIPTION_SOURCE = 'detected_subscription'

export type CashflowItemRow = {
  id: string
  description: string
  kind: 'income' | 'expense' | 'transfer' | 'super_contribution'
  person_key: string | null
  amount_cents: number
  currency: string
  frequency: 'once' | RecurrenceFreq
  start_date: string
  status: 'planned' | 'paid' | 'cancelled'
  category_id: string | null
  account_id: string | null
  notes: string | null
  source_table: string | null
}

// ── Goals › Upcoming payments (one-off expenses) ─────────────────────────────

export type Outflow = {
  id: string
  description: string
  amount_cents: number      // positive
  due_date: string
  status: 'planned' | 'paid' | 'cancelled'
  category: string | null
  notes: string | null
}

export function cashflowToOutflow(r: CashflowItemRow, categoryName: (id: string) => string | undefined): Outflow {
  const legacyCat = r.notes?.match(/category: ([^·]+)$/)?.[1]?.trim() ?? null
  return {
    id: r.id,
    description: r.description,
    amount_cents: Math.abs(r.amount_cents),
    due_date: r.start_date,
    status: r.status,
    category: (r.category_id ? categoryName(r.category_id) : undefined) ?? legacyCat,
    notes: r.notes?.replace(/\s*·?\s*category: [^·]+$/, '').trim() || null,
  }
}

export type OutflowInput = { description: string; amount_cents: number; due_date: string; category?: string | null; notes?: string | null; account_id?: string | null }

/** Fields for a planned_cashflows one-off expense. An unknown category name is kept in the notes. */
export function outflowToCashflow(input: OutflowInput, categoryId: string | null) {
  const cat = input.category?.trim() || null
  const notes = [input.notes?.trim() || null, cat && !categoryId ? `category: ${cat}` : null].filter(Boolean).join(' · ') || null
  return {
    description: input.description.trim(),
    kind: 'expense' as const,
    amount_cents: -Math.abs(Math.round(input.amount_cents)),
    currency: 'AUD',
    frequency: 'once' as const,
    start_date: input.due_date,
    category_id: categoryId,
    account_id: input.account_id ?? null,
    notes,
  }
}

// ── Settings › Recurring ─────────────────────────────────────────────────────

export type Recurring = {
  id: string; description: string; amount_cents: number; currency: string
  category_id: string | null; account_id: string | null
  owner: 'joint' | 'rachel' | 'evan'; recurrence: RecurrenceFreq
  day_of_month: number | null; next_due: string; is_active: boolean; notes: string | null
  /** Already counted in recent spending/pay, so the projection skips it. */
  in_spending: boolean
}

export function cashflowToRecurring(r: CashflowItemRow): Recurring | null {
  if (r.frequency === 'once') return null
  const owner = r.person_key === 'rachel' || r.person_key === 'evan' ? r.person_key : 'joint'
  const signed = r.kind === 'income' ? Math.abs(r.amount_cents) : -Math.abs(r.amount_cents)
  return {
    id: r.id, description: r.description, amount_cents: signed, currency: r.currency,
    category_id: r.category_id, account_id: r.account_id, owner, recurrence: r.frequency,
    day_of_month: Number(r.start_date.slice(8, 10)), next_due: r.start_date, is_active: r.status === 'planned', notes: r.notes,
    in_spending: r.source_table !== null && RECURRING_IN_SPENDING_SOURCES.has(r.source_table),
  }
}

export type RecurringInput = Omit<Recurring, 'id' | 'day_of_month'> & { day_of_month?: number | null }

/** Fields for a planned_cashflows recurring row. `existingSource` keeps a copied row's provenance. */
export function recurringToCashflow(input: RecurringInput, existingSource: string | null = null) {
  const source = input.in_spending
    ? (existingSource && RECURRING_IN_SPENDING_SOURCES.has(existingSource) ? existingSource : 'settings_recurring')
    : null
  return {
    description: input.description.trim(),
    kind: input.amount_cents >= 0 ? 'income' as const : 'expense' as const,
    person_key: input.owner === 'joint' ? null : input.owner,
    amount_cents: input.amount_cents,
    currency: input.currency,
    is_gross: false,
    frequency: input.recurrence,
    start_date: input.next_due,
    category_id: input.category_id ?? null,
    account_id: input.account_id ?? null,
    status: input.is_active ? 'planned' as const : 'cancelled' as const,
    notes: input.notes?.trim() || null,
    source_table: source,
  }
}

/** Next due date after posting one occurrence. Month-ends clamp (31 Jan → 28/29 Feb). */
export function advanceDate(dateStr: string, recurrence: RecurrenceFreq): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const step = { weekly: 0, fortnightly: 0, monthly: 1, quarterly: 3, annual: 12 }[recurrence]
  let yy = y, mm = m, dd = d
  if (recurrence === 'weekly' || recurrence === 'fortnightly') {
    const dt = new Date(Date.UTC(y, m - 1, d + (recurrence === 'weekly' ? 7 : 14)))
    yy = dt.getUTCFullYear(); mm = dt.getUTCMonth() + 1; dd = dt.getUTCDate()
  } else {
    const total = (y * 12 + (m - 1)) + step
    yy = Math.floor(total / 12); mm = (total % 12) + 1
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
    dd = Math.min(d, last)
  }
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

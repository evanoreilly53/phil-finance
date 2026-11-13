'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { advanceDate, recurringToCashflow, type RecurrenceFreq, type RecurringInput } from '@/lib/plannedItems'

// ── App Settings ──────────────────────────────────────────────────────────────

import type { Json } from '@/lib/supabase/database.types'

export async function updateSetting(key: string, value: Json): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return {}
}

// ── Categorisation Rules ──────────────────────────────────────────────────────

export type RuleInput = {
  pattern: string
  category_id: string
  owner?: 'joint' | 'rachel' | 'evan' | null
  priority: number
  is_active: boolean
}

export async function addRule(input: RuleInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('categorisation_rules')
    .insert({ ...input, created_by: user.id })

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

export async function updateRule(id: string, input: Partial<RuleInput>): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('categorisation_rules').update(input).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

export async function deleteRule(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('categorisation_rules').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

// ── Recurring ─────────────────────────────────────────────────────────────────
// Since Phase 3 recurring items are planned_cashflows rows (frequency ≠ once),
// so there's one list the projection reads. "Already in our spending" items
// are skipped by the projection (they're in your recent average); untick it
// for something new, like a gym membership starting next month. The old
// recurring_transactions table is kept as an archive and no longer written.

export type { RecurringInput } from '@/lib/plannedItems'

const RECURRING_PATHS = ['/settings', '/dashboard', '/future', '/house']
function revalidateRecurring() { for (const p of RECURRING_PATHS) revalidatePath(p) }

function validRecurring(input: RecurringInput): string | null {
  if (!input.description?.trim()) return 'Add a description'
  if (!Number.isSafeInteger(input.amount_cents) || input.amount_cents === 0) return 'Enter a valid amount'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.next_due)) return 'Pick the next due date'
  if (!['weekly', 'fortnightly', 'monthly', 'quarterly', 'annual'].includes(input.recurrence)) return 'Pick how often'
  return null
}

const onlyRecurring = <Q extends { neq: (c: string, v: string) => Q; is: (c: string, v: null) => Q; eq: (c: string, v: boolean) => Q }>(q: Q) =>
  q.neq('frequency', 'once').is('scenario_id', null).eq('is_gross', false)

export async function addRecurring(input: RecurringInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const bad = validRecurring(input)
  if (bad) return { error: bad }
  const { error } = await supabase.from('planned_cashflows').insert({ ...recurringToCashflow(input), created_by: user.id })
  if (error) return { error: error.message }
  revalidateRecurring()
  return {}
}

export async function updateRecurring(id: string, input: RecurringInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const bad = validRecurring(input)
  if (bad) return { error: bad }
  const { data: row } = await supabase.from('planned_cashflows').select('source_table').eq('id', id).maybeSingle()
  const { error } = await onlyRecurring(supabase.from('planned_cashflows').update(recurringToCashflow(input, row?.source_table ?? null)).eq('id', id))
  if (error) return { error: error.message }
  revalidateRecurring()
  return {}
}

export async function deleteRecurring(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await onlyRecurring(supabase.from('planned_cashflows').delete().eq('id', id))
  if (error) return { error: error.message }
  revalidateRecurring()
  return {}
}

export async function postRecurring(
  recurring: { id: string; description: string; amount_cents: number; currency: string; category_id: string | null; account_id: string | null; owner: 'joint' | 'rachel' | 'evan'; next_due: string; recurrence: RecurrenceFreq }
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Templates carry no FX rate, so a non-AUD amount would be stored as if it
  // were AUD. Refuse rather than write a wrong number.
  if ((recurring.currency ?? 'AUD').toUpperCase() !== 'AUD') {
    return { error: `Can't auto-post a ${recurring.currency} item (no exchange rate). Add it via Add Transaction instead.` }
  }

  const { error: txError } = await supabase.from('transactions').insert({
    date:             recurring.next_due,
    description:      recurring.description,
    amount_cents:     recurring.amount_cents,
    currency:         'AUD',
    aud_amount_cents: recurring.amount_cents,
    fx_rate:          1,
    account_id:       recurring.account_id,
    category_id:      recurring.category_id,
    owner:            recurring.owner,
    is_large_one_off: false,
    created_by:       user.id,
  })
  if (txError) return { error: txError.message }

  // Advance the next due date (the schedule's anchor; past occurrences don't affect the projection).
  const { error: upErr } = await onlyRecurring(supabase.from('planned_cashflows')
    .update({ start_date: advanceDate(recurring.next_due, recurring.recurrence) }).eq('id', recurring.id))
  if (upErr) return { error: upErr.message }

  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath('/transactions')
  revalidateTag('transactions', 'max')
  return {}
}

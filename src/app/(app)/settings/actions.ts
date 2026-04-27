'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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

// ── Recurring Transactions ────────────────────────────────────────────────────

export type RecurringInput = {
  description: string
  amount_cents: number
  currency: string
  category_id?: string | null
  account_id?: string | null
  owner: 'joint' | 'rachel' | 'evan'
  recurrence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'
  day_of_month?: number | null
  next_due: string
  is_active: boolean
  notes?: string | null
}

export async function addRecurring(input: RecurringInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('recurring_transactions')
    .insert({ ...input, created_by: user.id })

  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return {}
}

export async function updateRecurring(id: string, input: Partial<RecurringInput>): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('recurring_transactions').update(input).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return {}
}

export async function deleteRecurring(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('recurring_transactions').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return {}
}

export async function postRecurring(
  recurring: { id: string; description: string; amount_cents: number; currency: string; category_id: string | null; account_id: string | null; owner: 'joint' | 'rachel' | 'evan'; next_due: string; recurrence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual' }
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error: txError } = await supabase.from('transactions').insert({
    date:             recurring.next_due,
    description:      recurring.description,
    amount_cents:     recurring.amount_cents,
    currency:         recurring.currency,
    aud_amount_cents: recurring.amount_cents, // assumes AUD; FX handled separately
    account_id:       recurring.account_id,
    category_id:      recurring.category_id,
    owner:            recurring.owner,
    is_large_one_off: false,
    created_by:       user.id,
  })
  if (txError) return { error: txError.message }

  // Advance next_due
  const nextDue = advanceDate(recurring.next_due, recurring.recurrence)
  const { error: upErr } = await supabase.from('recurring_transactions').update({ next_due: nextDue }).eq('id', recurring.id)
  if (upErr) return { error: upErr.message }

  revalidatePath('/dashboard')
  revalidatePath('/transactions')
  revalidateTag('transactions', 'max')
  return {}
}

function advanceDate(dateStr: string, recurrence: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  switch (recurrence) {
    case 'weekly':      date.setDate(date.getDate() + 7);        break
    case 'fortnightly': date.setDate(date.getDate() + 14);       break
    case 'monthly':     date.setMonth(date.getMonth() + 1);      break
    case 'quarterly':   date.setMonth(date.getMonth() + 3);      break
    case 'annual':      date.setFullYear(date.getFullYear() + 1); break
  }
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { matchCategory } from '@/lib/categorise'

export type TransactionInput = {
  date: string
  description: string
  amount_cents: number        // signed: negative=expense, positive=income
  currency: string
  aud_amount_cents: number
  fx_rate?: number
  account_id: string
  category_id: string
  owner: 'joint' | 'rachel' | 'evan'
  is_large_one_off: boolean
  notes?: string
}

export async function addTransaction(input: TransactionInput): Promise<{ id: string; autoCategory?: boolean } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  let { category_id } = input
  let autoCategory = false

  // Auto-categorise if no category given
  if (!category_id) {
    const { data: rules } = await supabase.from('categorisation_rules').select('pattern, category_id, owner, priority, is_active')
    const matched = matchCategory(input.description, input.owner, rules ?? [])
    if (matched) { category_id = matched; autoCategory = true }
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert({ ...input, category_id, created_by: user.id })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/transactions')
  return { id: data.id, autoCategory }
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // No created_by filter: either household member may fix the other's rows.
  // RLS ("Household members can update", 0002_rls_household.sql) is the guard.
  const { data, error } = await supabase
    .from('transactions')
    .update({ ...input })
    .eq('id', id)
    .select('id')

  if (error) return { error: error.message }
  // PostgREST reports success for 0 rows affected — surface it instead of failing silently
  if (!data || data.length === 0) return { error: 'Transaction not found or you do not have permission to edit it' }
  revalidatePath('/transactions')
  return {}
}

export async function deleteTransaction(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // No created_by filter — RLS ("Household members can delete") is the guard.
  const { data, error } = await supabase.from('transactions').delete().eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Transaction not found or you do not have permission to delete it' }
  revalidatePath('/transactions')
  return {}
}

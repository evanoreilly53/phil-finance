'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type WeddingItemInput = {
  item: string
  status?: 'pending' | 'deposit_paid' | 'paid' | 'cancelled'
  budget_aud_cents?: number | null
  budget_eur_cents?: number | null
  spent_aud_cents?: number | null
  spent_eur_cents?: number | null
  balance_owed_eur_cents?: number | null
  date_paid?: string | null
  notes?: string | null
  sort_order?: number | null
}

export async function addWeddingItem(input: WeddingItemInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('wedding_items').insert(input)
  if (error) return { error: error.message }
  revalidatePath('/wedding')
  return {}
}

export async function updateWeddingItem(id: string, input: WeddingItemInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('wedding_items').update(input).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/wedding')
  return {}
}

export async function deleteWeddingItem(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('wedding_items').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/wedding')
  return {}
}

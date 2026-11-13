'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { archiveUpdate } from '@/lib/wedding'
import type { Json } from '@/lib/supabase/database.types'

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

// ── Archive (Phase 4) ─────────────────────────────────────────────────────────
// Archiving flips the wedding life event to is_archived (it stays a pin on the
// Future timeline); reopening sets keep_open so a fully paid wedding stays
// editable. Both are reversible and change nothing else.

export async function setWeddingArchived(archive: boolean): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: ev, error: e1 } = await supabase.from('life_events').select('id, params').eq('kind', 'wedding').order('created_at').limit(1).maybeSingle()
  if (e1) return { error: e1.message }
  if (!ev) return { error: 'No wedding event found (migration 0008 creates it).' }
  const { error } = await supabase.from('life_events').update(archiveUpdate(ev.params, archive) as { is_archived: boolean; params: Json }).eq('id', ev.id)
  if (error) return { error: error.message }
  for (const p of ['/wedding', '/more', '/future', '/dashboard']) revalidatePath(p)
  return {}
}

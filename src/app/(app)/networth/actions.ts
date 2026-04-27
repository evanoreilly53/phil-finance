'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type SnapshotInput = {
  date: string
  account_id: string
  balance_cents: number
  currency: string
  aud_balance_cents: number
  fx_rate: number
}

export async function saveSnapshots(snapshots: SnapshotInput[]): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const rows = snapshots.map(s => ({ ...s, created_by: user.id }))
  const { error } = await supabase
    .from('account_snapshots')
    .upsert(rows, { onConflict: 'date,account_id' })

  if (error) return { error: error.message }
  revalidatePath('/networth')
  return {}
}

export async function deleteSnapshot(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('account_snapshots')
    .delete()
    .eq('id', id)
    .eq('created_by', user.id)

  if (error) return { error: error.message }
  revalidatePath('/networth')
  return {}
}

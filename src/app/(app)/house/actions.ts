'use server'

// Home Loan mode (Phase 5): mark the shared house purchase as bought, or undo
// it. Only the status changes ('done' ↔ 'planned'), so it is fully reversible
// and the purchase details are kept.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function setHouseBought(eventId: string, bought: boolean): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: ev, error: rErr } = await supabase.from('life_events').select('id, status, scenario_id').eq('id', eventId).eq('kind', 'house_purchase').maybeSingle()
  if (rErr) return { error: rErr.message }
  if (!ev) return { error: 'House plan not found' }
  if (ev.scenario_id) return { error: 'Only the baseline house can be marked as bought' }
  if (ev.status === 'cancelled') return { error: 'This house plan is cancelled' }
  const { error } = await supabase.from('life_events').update({ status: bought ? 'done' : 'planned' }).eq('id', eventId)
  if (error) return { error: error.message }
  for (const p of ['/house', '/dashboard', '/future', '/insights', '/more/assumptions']) revalidatePath(p)
  return {}
}

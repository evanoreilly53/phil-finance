'use server'

// Super cap tracker: voluntary concessional contributions (salary sacrifice or
// personal contributions you'll claim) entered per person. Stored as
// planned_cashflows rows (kind super_contribution, source_table
// 'super_concessional'): paid once dated today or earlier, otherwise planned,
// so future ones also move cash into super in the projection.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { perthToday } from '@/lib/import/dates'
import { CONCESSIONAL_SOURCE } from '@/lib/superCap'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const FREQ = ['once', 'monthly', 'fortnightly'] as const

function revalidate() { for (const p of ['/income', '/insights', '/dashboard', '/future', '/house']) revalidatePath(p) }

export async function addConcessional(input: { personKey: string; amountCents: number; date: string; frequency: (typeof FREQ)[number]; description?: string }): Promise<{ error?: string }> {
  if (!/^[a-z][a-z0-9_]*$/.test(input.personKey)) return { error: 'Pick a person' }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 5_000_000) return { error: 'Enter an amount up to $50,000' }
  if (!ISO.test(input.date)) return { error: 'Pick a date' }
  if (!FREQ.includes(input.frequency)) return { error: 'Pick how often' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const paid = input.frequency === 'once' && input.date <= perthToday()
  const { error } = await supabase.from('planned_cashflows').insert({
    description: (input.description?.trim() || (input.frequency === 'once' ? 'Concessional super contribution' : 'Salary sacrifice to super')).slice(0, 80),
    kind: 'super_contribution', person_key: input.personKey, amount_cents: input.amountCents, currency: 'AUD', is_gross: false,
    frequency: input.frequency, start_date: input.date, status: paid ? 'paid' : 'planned', source_table: CONCESSIONAL_SOURCE, created_by: user.id,
  })
  if (error) return { error: error.message }
  revalidate()
  return {}
}

export async function removeConcessional(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  // Cancelled rather than deleted (kept in the audit trail and history).
  const { error } = await supabase.from('planned_cashflows').update({ status: 'cancelled' }).eq('id', id).eq('source_table', CONCESSIONAL_SOURCE)
  if (error) return { error: error.message }
  revalidate()
  return {}
}

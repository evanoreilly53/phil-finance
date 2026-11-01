'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { matchCategory } from '@/lib/categorise'

export type ImportRow = {
  date: string
  description: string
  amount_cents: number        // signed
  aud_amount_cents: number
  currency: string
  fx_rate?: number
  account_id: string
  category_id: string
  owner: 'joint' | 'rachel' | 'evan'
  is_large_one_off: boolean
  notes?: string
}

export async function commitImport(rows: ImportRow[]): Promise<{ imported: number; error?: string }> {
  if (rows.length === 0) return { imported: 0 }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { imported: 0, error: 'Not authenticated' }

  // Server-side guard: never store a foreign amount as if it were AUD, and never
  // hand Postgres an ambiguous date (its MDY default would swap day/month).
  const bad = rows.find(r =>
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
    (r.currency !== 'AUD' && !(typeof r.fx_rate === 'number' && r.fx_rate > 0)),
  )
  if (bad) return { imported: 0, error: `Invalid row "${bad.description}": needs an ISO date and, for non-AUD, an FX rate` }

  const { data: rules } = await supabase
    .from('categorisation_rules')
    .select('pattern, category_id, owner, priority, is_active')
    .eq('is_active', true)

  const toInsert = rows.map(r => ({
    ...r,
    category_id: r.category_id || matchCategory(r.description, r.owner, rules ?? []) || null,
    created_by: user.id,
  }))

  const BATCH = 100
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const { error } = await supabase.from('transactions').insert(toInsert.slice(i, i + BATCH))
    if (error) return { imported: inserted, error: error.message }
    inserted += Math.min(BATCH, toInsert.length - i)
  }

  revalidatePath('/transactions')
  return { imported: inserted }
}

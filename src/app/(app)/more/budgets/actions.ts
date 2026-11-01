'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { perthMonthKey } from '@/lib/format'

/** Set (or change) a category's monthly target from this month on. 0 = no target. */
export async function setBudget(categoryId: string, monthlyCents: number): Promise<{ error?: string }> {
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents < 0) return { error: 'Enter a positive amount' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Versioned by month: earlier months keep the target they had.
  const { error } = await supabase.from('budgets').upsert(
    { category_id: categoryId, monthly_cents: monthlyCents, effective_from: `${perthMonthKey()}-01`, created_by: user.id },
    { onConflict: 'category_id,effective_from' },
  )
  if (error) return { error: error.message }
  revalidatePath('/more/budgets')
  return {}
}

import { createClient } from '@/lib/supabase/server'
import WeddingView from './WeddingView'
import { getSetting } from '@/lib/settings'

export default async function WeddingPage() {
  const supabase = await createClient()

  const [{ data: items }, { data: fxRow }, weddingBudgetCents] = await Promise.all([
    supabase.from('wedding_items').select('*').order('sort_order'),
    supabase
      .from('fx_rates')
      .select('rate')
      .eq('from_currency', 'EUR')
      .eq('to_currency', 'AUD')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getSetting<number>('wedding_budget_cents', 7500000),
  ])

  const eurToAud = fxRow?.rate ?? 1.65
  const budgetAud = Math.round(weddingBudgetCents / 100)

  return <WeddingView items={items ?? []} budget={budgetAud} eurToAud={eurToAud} />
}

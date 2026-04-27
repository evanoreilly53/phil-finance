import { createClient } from '@/lib/supabase/server'
import SpendingView, { type Transaction as SpendingTx } from './SpendingView'

export default async function SpendingPage() {
  const supabase = await createClient()

  const [{ data: transactions }, { data: categories }] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, date, description, aud_amount_cents, owner, is_large_one_off, category_id, categories(id, name, colour, parent_id)')
      .lt('aud_amount_cents', 0)   // expenses only
      .order('date', { ascending: false }),
    supabase
      .from('categories')
      .select('id, name, parent_id, owner, colour')
      .order('sort_order'),
  ])

  return (
    <SpendingView
      transactions={(transactions ?? []) as unknown as SpendingTx[]}
      categories={categories ?? []}
    />
  )
}

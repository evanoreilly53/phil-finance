import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import SpendingView, { type Transaction as SpendingTx } from './SpendingView'

export default async function SpendingPage() {
  const supabase = await createClient()

  const [transactions, { data: categories }] = await Promise.all([
    // Paged: a plain select silently stops at 1,000 rows
    fetchAll((from, to) => supabase
      .from('transactions')
      .select('id, date, description, aud_amount_cents, owner, is_large_one_off, category_id, categories(id, name, colour, parent_id)')
      .lt('aud_amount_cents', 0)   // expenses only
      .order('date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)),
    supabase
      .from('categories')
      .select('id, name, parent_id, owner, colour')
      .order('sort_order'),
  ])

  return (
    <SpendingView
      transactions={transactions as unknown as SpendingTx[]}
      categories={categories ?? []}
    />
  )
}

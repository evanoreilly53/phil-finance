import { createClient } from '@/lib/supabase/server'
import { perthMonthKey, addMonths } from '@/lib/format'
import { fetchAll } from '@/lib/supabase/fetchAll'
import TransactionList, { type Transaction } from './TransactionList'

type SearchParams = Promise<{ from?: string; all?: string }>

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const supabase = await createClient()

  // Default: last 90 days (3 months back). Pass ?all=1 to load everything.
  const thisMonth = perthMonthKey()
  const fromMonth = addMonths(thisMonth, -3)
  const fromDate  = params.from ?? (params.all ? '2000-01-01' : `${fromMonth}-01`)

  const [transactions, { data: categories }, { data: accounts }] = await Promise.all([
    // Paged: a plain select silently stops at 1,000 rows (?all=1 easily exceeds that)
    fetchAll((from, to) => supabase
      .from('transactions')
      .select('id, date, description, amount_cents, aud_amount_cents, currency, fx_rate, owner, is_large_one_off, notes, account_id, category_id, categories(id, name, colour), accounts(id, name)')
      .gte('date', fromDate)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)),
    supabase
      .from('categories')
      .select('id, name, parent_id, owner, colour')
      .order('sort_order'),
    supabase
      .from('accounts')
      .select('id, name, type, owner, currency')
      .eq('is_active', true)
      .order('name'),
  ])

  const isFiltered = !params.all
  const fromLabel  = isFiltered ? `${fromMonth}-01` : null

  return (
    <TransactionList
      transactions={transactions as unknown as Transaction[]}
      categories={categories ?? []}
      accounts={accounts ?? []}
      fromDate={fromLabel}
    />
  )
}

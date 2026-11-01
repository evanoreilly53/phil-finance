import Link from 'next/link'
import type { Route } from 'next'
import { Inbox, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { perthMonthKey, addMonths } from '@/lib/format'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { addDays, perthToday } from '@/lib/import/dates'
import TransactionList, { type Transaction } from './TransactionList'
import TrackTabs from '@/components/TrackTabs'

type SearchParams = Promise<{ from?: string; all?: string }>

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const supabase = await createClient()

  // Default: last 90 days (3 months back). Pass ?all=1 to load everything.
  const thisMonth = perthMonthKey()
  const fromMonth = addMonths(thisMonth, -3)
  const fromDate  = params.from ?? (params.all ? '2000-01-01' : `${fromMonth}-01`)
  const since     = addDays(perthToday(), -90)

  const [transactions, { data: categories }, { data: accounts }, { count: reviewCount }] = await Promise.all([
    // Paged: a plain select silently stops at 1,000 rows (?all=1 easily exceeds that)
    fetchAll((from, to) => supabase
      .from('transactions')
      .select('id, date, description, amount_cents, aud_amount_cents, currency, fx_rate, owner, is_large_one_off, is_transfer, notes, account_id, category_id, categories(id, name, colour), accounts!transactions_account_id_fkey(id, name)')
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
    // Same definition as the review queue page
    supabase.from('transactions').select('id', { count: 'exact', head: true })
      .or(`needs_review.eq.true,and(category_id.is.null,is_transfer.eq.false,date.gte.${since})`),
  ])

  const isFiltered = !params.all
  const fromLabel  = isFiltered ? `${fromMonth}-01` : null

  return (
    <div className="space-y-3">
      <TrackTabs />
      <div className="flex gap-2">
        <Link href={'/transactions/review' as Route}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
            (reviewCount ?? 0) > 0 ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200'}`}>
          <Inbox size={15} /> {(reviewCount ?? 0) > 0 ? `${reviewCount} to review` : 'Review queue'}
        </Link>
        <Link href="/transactions/import"
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium bg-gray-900 border border-gray-800 text-gray-300 hover:text-white transition-colors">
          <Upload size={15} /> Import CSV
        </Link>
      </div>
      <TransactionList
        transactions={transactions as unknown as Transaction[]}
        categories={categories ?? []}
        accounts={accounts ?? []}
        fromDate={fromLabel}
      />
    </div>
  )
}

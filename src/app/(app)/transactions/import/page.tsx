import { createClient } from '@/lib/supabase/server'
import CsvImport from './CsvImport'
import type { Category } from '../TransactionList'

type SearchParams = Promise<{ account?: string }>

export default async function ImportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const supabase = await createClient()

  const [{ data: categories }, { data: accounts }, { data: rules }, { data: fxRows }] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id, owner, colour').order('sort_order'),
    supabase.from('accounts')
      .select('id, name, type, owner, currency, import_profile, institution')
      .eq('is_active', true)
      .order('sort_order').order('name'),
    supabase.from('categorisation_rules').select('pattern, category_id, owner, priority, is_active').eq('is_active', true),
    // Most recent stored rates (kept fresh by /api/fx/refresh), used to pre-fill the FX inputs
    supabase.from('fx_rates').select('from_currency, rate, date').eq('to_currency', 'AUD')
      .order('date', { ascending: false }).limit(50),
  ])

  const latestRates: Record<string, { rate: number; date: string }> = {}
  for (const r of fxRows ?? []) {
    if (!latestRates[r.from_currency]) latestRates[r.from_currency] = { rate: Number(r.rate), date: r.date }
  }
  const list = accounts ?? []
  const initialAccountId = list.some(a => a.id === params.account) ? params.account! : null

  return (
    <CsvImport
      categories={(categories ?? []) as Category[]}
      accounts={list}
      rules={rules ?? []}
      latestRates={latestRates}
      initialAccountId={initialAccountId}
    />
  )
}

import { createClient } from '@/lib/supabase/server'
import CsvImport from './CsvImport'
import type { Category } from '../TransactionList'

export default async function ImportPage() {
  const supabase = await createClient()

  const [{ data: categories }, { data: accounts }, { data: rules }, { data: fxRows }] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id, owner, colour').order('sort_order'),
    supabase.from('accounts').select('id, name, type, owner, currency').eq('is_active', true).order('name'),
    supabase.from('categorisation_rules').select('pattern, category_id, owner, priority, is_active').eq('is_active', true),
    // Most recent stored rates, used only to pre-fill the FX inputs
    supabase.from('fx_rates').select('from_currency, rate, date').eq('to_currency', 'AUD')
      .order('date', { ascending: false }).limit(50),
  ])

  const latestRates: Record<string, { rate: number; date: string }> = {}
  for (const r of fxRows ?? []) {
    if (!latestRates[r.from_currency]) latestRates[r.from_currency] = { rate: Number(r.rate), date: r.date }
  }

  return (
    <CsvImport
      categories={(categories ?? []) as Category[]}
      accounts={accounts ?? []}
      rules={rules ?? []}
      latestRates={latestRates}
    />
  )
}

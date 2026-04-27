import { createClient } from '@/lib/supabase/server'
import CsvImport from './CsvImport'
import type { Category } from '../TransactionList'

export default async function ImportPage() {
  const supabase = await createClient()

  const [{ data: categories }, { data: accounts }, { data: rules }] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id, owner, colour').order('sort_order'),
    supabase.from('accounts').select('id, name, type, owner, currency').eq('is_active', true).order('name'),
    supabase.from('categorisation_rules').select('pattern, category_id, owner, priority, is_active').eq('is_active', true),
  ])

  return (
    <CsvImport
      categories={(categories ?? []) as Category[]}
      accounts={accounts ?? []}
      rules={rules ?? []}
    />
  )
}

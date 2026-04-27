import { createClient } from '@/lib/supabase/server'
import SettingsView from './SettingsView'
import type { Category } from '../transactions/TransactionList'

export default async function SettingsPage() {
  const supabase = await createClient()

  const [
    { data: appSettings },
    { data: rules },
    { data: recurring },
    { data: categories },
    { data: accounts },
  ] = await Promise.all([
    supabase.from('app_settings').select('key, value'),
    supabase.from('categorisation_rules').select('id, pattern, category_id, owner, priority, is_active').order('priority', { ascending: false }),
    supabase.from('recurring_transactions').select('id, description, amount_cents, currency, category_id, account_id, owner, recurrence, day_of_month, next_due, is_active, notes').order('next_due'),
    supabase.from('categories').select('id, name, parent_id, owner, colour').order('sort_order'),
    supabase.from('accounts').select('id, name, type, owner, currency').eq('is_active', true).order('name'),
  ])

  const settingsMap: Record<string, unknown> = {}
  for (const s of appSettings ?? []) settingsMap[s.key] = s.value

  return (
    <SettingsView
      settings={settingsMap}
      rules={rules ?? []}
      recurring={recurring ?? []}
      categories={(categories ?? []) as Category[]}
      accounts={accounts ?? []}
    />
  )
}

import { createClient } from '@/lib/supabase/server'
import SettingsView from './SettingsView'
import { cashflowToRecurring, type CashflowItemRow, type Recurring } from '@/lib/plannedItems'
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
    // Recurring items live in planned_cashflows since Phase 3 (one list, read by the projection).
    supabase.from('planned_cashflows').select('id, description, kind, person_key, amount_cents, currency, frequency, start_date, status, category_id, account_id, notes, source_table')
      .neq('frequency', 'once').is('scenario_id', null).eq('is_gross', false).is('event_id', null).neq('kind', 'transfer').neq('kind', 'super_contribution').order('start_date'),
    supabase.from('categories').select('id, name, parent_id, owner, colour').order('sort_order'),
    supabase.from('accounts').select('id, name, type, owner, currency').eq('is_active', true).order('name'),
  ])

  const settingsMap: Record<string, unknown> = {}
  for (const s of appSettings ?? []) settingsMap[s.key] = s.value

  return (
    <SettingsView
      settings={settingsMap}
      rules={rules ?? []}
      recurring={((recurring ?? []) as CashflowItemRow[]).map(cashflowToRecurring).filter((r): r is Recurring => r !== null)}
      categories={(categories ?? []) as Category[]}
      accounts={accounts ?? []}
    />
  )
}

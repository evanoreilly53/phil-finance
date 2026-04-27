import { createClient } from '@/lib/supabase/server'
import NetWorthView from './NetWorthView'

export default async function NetWorthPage() {
  const supabase = await createClient()

  const [{ data: snapshots }, { data: accounts }, { data: goals }] = await Promise.all([
    supabase
      .from('account_snapshots')
      .select('id, date, account_id, aud_balance_cents, balance_cents, currency, fx_rate')
      .order('date', { ascending: true }),
    supabase
      .from('accounts')
      .select('id, name, type, currency, owner, is_liquid')
      .eq('is_active', true),
    supabase
      .from('goals')
      .select('id, name, kind, target_cents, current_cents, target_date')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  return (
    <NetWorthView
      snapshots={snapshots ?? []}
      accounts={accounts ?? []}
      goals={goals ?? []}
    />
  )
}

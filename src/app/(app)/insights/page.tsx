import { createClient } from '@/lib/supabase/server'
import InsightsView from './InsightsView'
import { getSetting } from '@/lib/settings'
import type { Transaction } from './InsightsView'

export default async function InsightsPage() {
  const supabase = await createClient()

  const [
    { data: transactions },
    { data: snapshots },
    { data: accounts },
    { data: categories },
    monthlyIncomeCents,
    personalBudgetCents,
  ] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, date, aud_amount_cents, owner, category_id, categories(id, name, parent_id)')
      .lt('aud_amount_cents', 0)
      .order('date'),
    supabase
      .from('account_snapshots')
      .select('date, account_id, aud_balance_cents')
      .order('date', { ascending: true }),
    supabase.from('accounts').select('id, name, type'),
    supabase.from('categories').select('id, name, parent_id'),
    getSetting<number>('monthly_income_cents',  1256300),
    getSetting<number>('personal_budget_cents', 80000),
  ])

  return (
    <InsightsView
      transactions={(transactions ?? []) as unknown as Transaction[]}
      snapshots={snapshots ?? []}
      accounts={accounts ?? []}
      categories={categories ?? []}
      monthlyIncomeCents={monthlyIncomeCents}
      personalBudgetCents={personalBudgetCents}
    />
  )
}

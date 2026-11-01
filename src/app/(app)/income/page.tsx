import { createClient } from '@/lib/supabase/server'
import { perthMonthKey } from '@/lib/format'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { totalsByMonth } from '@/lib/income'
import IncomeView from './IncomeView'
import type { Transaction } from '../transactions/TransactionList'
import { getSetting } from '@/lib/settings'

type HouseholdMember = { key: 'rachel' | 'evan'; label: string; income_cents: number }

export default async function IncomePage() {
  const supabase = await createClient()
  const thisMonth = perthMonthKey()
  const yearStart = `${thisMonth.slice(0, 4)}-01-01`
  const monthsElapsed = parseInt(thisMonth.slice(5, 7), 10)

  const [transactions, expenses, { data: categories }, { data: accounts }, householdMembers, monthlyIncome] = await Promise.all([
    fetchAll((from, to) => supabase
      .from('transactions')
      .select('id, date, description, amount_cents, aud_amount_cents, currency, fx_rate, owner, is_large_one_off, notes, account_id, category_id, categories(id, name, colour), accounts(id, name)')
      .gt('aud_amount_cents', 0)
      .gte('date', yearStart)
      .order('date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)),
    // Expenses for the Income-vs-Spending chart (only date + amount needed)
    fetchAll((from, to) => supabase
      .from('transactions')
      .select('date, aud_amount_cents')
      .lt('aud_amount_cents', 0)
      .gte('date', yearStart)
      .order('id', { ascending: true })
      .range(from, to)),
    supabase.from('categories').select('id, name, parent_id, owner, colour').order('sort_order'),
    supabase.from('accounts').select('id, name, type, owner, currency').eq('is_active', true).order('name'),
    getSetting<HouseholdMember[]>('household_members', [
      { key: 'rachel', label: 'Rachel', income_cents: 671300 },
      { key: 'evan',   label: 'Evan',   income_cents: 585400 },
    ]),
    getSetting<number>('monthly_income_cents', 1256300),
  ])

  const allTxs = transactions as unknown as Transaction[]
  const spendByMonth = totalsByMonth(expenses, 'expense')

  const ytd = householdMembers.map(({ key, label, income_cents }) => {
    const ytdCents      = allTxs.filter(t => t.owner === key).reduce((s, t) => s + t.aud_amount_cents, 0)
    const expectedCents = income_cents * monthsElapsed
    return { key, label, ytdCents, expectedCents }
  })

  const jointYtdCents = allTxs.filter(t => t.owner === 'joint').reduce((s, t) => s + t.aud_amount_cents, 0)

  return (
    <IncomeView
      transactions={allTxs}
      spendByMonth={spendByMonth}
      categories={categories ?? []}
      accounts={accounts ?? []}
      ytd={ytd}
      jointYtdCents={jointYtdCents}
      monthlyIncomeCents={monthlyIncome}
    />
  )
}

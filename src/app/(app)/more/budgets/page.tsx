import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { perthMonthKey, monthLabel } from '@/lib/format'
import { budgetsForMonth, spendByCategory, UNCATEGORISED } from '@/lib/budgets'
import BudgetsView, { type BudgetLine } from './BudgetsView'

export default async function BudgetsPage() {
  const supabase = await createClient()
  const month = perthMonthKey()

  const [{ data: categories, error }, { data: budgets }, txs] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id, kind, colour, sort_order').order('sort_order'),
    supabase.from('budgets').select('category_id, monthly_cents, effective_from'),
    fetchAll((from, to) => supabase.from('transactions')
      .select('date, aud_amount_cents, category_id, is_transfer')
      .gte('date', `${month}-01`)
      .order('id').range(from, to)),
  ])
  if (error) throw new Error(`Failed to load categories: ${error.message}`)

  const cats = categories ?? []
  const targets = budgetsForMonth(budgets ?? [], month)
  const spent = spendByCategory(txs, month, cats, { rollup: true })

  const lines: BudgetLine[] = cats
    .filter(c => !c.parent_id && c.kind !== 'income' && c.kind !== 'transfer')
    .map(c => ({ id: c.id, name: c.name, colour: c.colour, kind: c.kind, spentCents: spent.get(c.id) ?? 0, targetCents: targets.get(c.id) ?? 0 }))

  return (
    <BudgetsView
      monthLabel={monthLabel(month)}
      lines={lines}
      uncategorisedCents={spent.get(UNCATEGORISED) ?? 0}
    />
  )
}

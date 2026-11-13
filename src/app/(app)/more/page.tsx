import Link from 'next/link'
import type { Route } from 'next'
import type { ElementType } from 'react'
import { Target, TrendingUp, Lightbulb, PiggyBank, Settings, Heart, Upload, Wallet, ChevronRight, SlidersHorizontal, Layers, Repeat } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { weddingArchiveState } from '@/lib/wedding'

type Item = { href: string; label: string; hint: string; icon: ElementType }

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Plan',
    items: [
      { href: '/more/assumptions', label: 'Assumptions', hint: 'House date, salaries, rates for the projection', icon: SlidersHorizontal },
      { href: '/future/scenarios', label: 'Scenarios', hint: 'What-ifs: buy earlier, one income, rates', icon: Layers },
      { href: '/goals',        label: 'Goals',        hint: 'Goal list and planned payments',       icon: Target },
      { href: '/more/budgets', label: 'Budgets',      hint: 'Light monthly targets per category',   icon: PiggyBank },
      { href: '/insights',     label: 'Monthly check-in', hint: 'What happened, budgets, top 3 things to look at', icon: Lightbulb },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/track/accounts',      label: 'Accounts',           hint: 'Assets, debts and data freshness', icon: Wallet },
      { href: '/networth',            label: 'Net worth',          hint: 'History and balance updates',      icon: TrendingUp },
      { href: '/track/bills',         label: 'Bills & subscriptions', hint: 'Recurring charges and what is due', icon: Repeat },
      { href: '/transactions/import', label: 'Import bank CSV',    hint: 'CommBank, AIB or any CSV',         icon: Upload },
    ],
  },
  {
    title: 'Household',
    items: [
      { href: '/settings', label: 'Settings', hint: 'Categories, rules, recurring, constants', icon: Settings },
    ],
  },
]

export default async function MorePage() {
  const supabase = await createClient()
  // The wedding stays reachable here; once archived it moves to Archive as a read-only page.
  const [{ data: wedding }, { data: event }] = await Promise.all([
    supabase.from('wedding_items').select('status, budget_aud_cents, spent_aud_cents'),
    supabase.from('life_events').select('is_archived, params').eq('kind', 'wedding').order('created_at').limit(1).maybeSingle(),
  ])
  const w = weddingArchiveState(wedding ?? [], event ?? null)
  const weddingItem: Item = {
    href: '/wedding', label: 'Our Wedding 2026', icon: Heart,
    hint: w.archived ? 'Read-only record: budget vs actual, total in AUD' : w.openItems > 0 ? `${w.openItems} item${w.openItems === 1 ? '' : 's'} still to pay` : 'All paid',
  }
  const groups = [...GROUPS, { title: w.archived ? 'Archive' : 'Events', items: [weddingItem] }]

  return (
    <div className="space-y-5">
      {groups.map(g => (
        <section key={g.title}>
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">{g.title}</h2>
          <ul className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
            {g.items.map(({ href, label, hint, icon: Icon }) => (
              <li key={href}>
                <Link href={href as Route} className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-800/60 transition-colors">
                  <Icon size={18} className="text-indigo-400 flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-white">{label}</span>
                    <span className="block text-[11px] text-gray-500 truncate">{hint}</span>
                  </span>
                  <ChevronRight size={16} className="text-gray-600" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

import Link from 'next/link'
import type { Route } from 'next'
import type { ElementType } from 'react'
import { Target, TrendingUp, Lightbulb, PiggyBank, Settings, Heart, Upload, Wallet, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

type Item = { href: string; label: string; hint: string; icon: ElementType }

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Plan',
    items: [
      { href: '/goals',        label: 'Goals',        hint: 'Moving to Future in Phase 2',          icon: Target },
      { href: '/more/budgets', label: 'Budgets',      hint: 'Light monthly targets per category',   icon: PiggyBank },
      { href: '/insights',     label: 'Insights',     hint: 'Replaced by the Home check-in later',  icon: Lightbulb },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/track/accounts',      label: 'Accounts',           hint: 'Assets, debts and data freshness', icon: Wallet },
      { href: '/networth',            label: 'Net worth',          hint: 'History and balance updates',      icon: TrendingUp },
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
  // The wedding stays reachable here; it moves to an Archive once every item is paid.
  const { data: wedding } = await supabase.from('wedding_items').select('status')
  const open = (wedding ?? []).filter(w => w.status !== 'paid' && w.status !== 'cancelled').length
  const weddingItem: Item = {
    href: '/wedding', label: 'Our Wedding 2026', icon: Heart,
    hint: open > 0 ? `${open} item${open === 1 ? '' : 's'} still to pay` : 'All paid: ready to archive',
  }
  const groups = [...GROUPS, { title: open > 0 ? 'Events' : 'Archive', items: [weddingItem] }]

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

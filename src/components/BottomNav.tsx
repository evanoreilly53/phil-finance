'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, TrendingUp, CreditCard, Heart, Target, List, Lightbulb, Settings } from 'lucide-react'
import type { Route } from 'next'
import type { ElementType } from 'react'

type NavItem = { href: Route; label: string; icon: ElementType }

const nav: NavItem[] = [
  { href: '/dashboard'    as Route, label: 'Home',      icon: LayoutDashboard },
  { href: '/networth'     as Route, label: 'NW',        icon: TrendingUp },
  { href: '/spending'     as Route, label: 'Spending',  icon: CreditCard },
  { href: '/wedding'      as Route, label: 'Wedding',   icon: Heart },
  { href: '/goals'        as Route, label: 'Goals',     icon: Target },
  { href: '/insights'     as Route, label: 'Insights',  icon: Lightbulb },
  { href: '/transactions' as Route, label: 'Txns',      icon: List },
  { href: '/settings'     as Route, label: 'Settings',  icon: Settings },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-gray-950 border-t border-gray-800">
      <div className="max-w-6xl mx-auto flex pb-safe">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                active ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, List, TrendingUp, House, Menu } from 'lucide-react'
import type { Route } from 'next'
import type { ElementType } from 'react'
import { sectionFor, type Section } from './nav'

type NavItem = { href: Route; label: string; icon: ElementType; section: Section }

const nav: NavItem[] = [
  { href: '/dashboard'    as Route, label: 'Home',   icon: Home,       section: 'home' },
  { href: '/transactions' as Route, label: 'Track',  icon: List,       section: 'track' },
  { href: '/future'       as Route, label: 'Future', icon: TrendingUp, section: 'future' },
  { href: '/house'        as Route, label: 'House',  icon: House,      section: 'house' },
  { href: '/more'         as Route, label: 'More',   icon: Menu,       section: 'more' },
]

export default function BottomNav() {
  const section = sectionFor(usePathname())

  return (
    <nav aria-label="Main" className="fixed bottom-0 left-0 right-0 z-40 bg-gray-950 border-t border-gray-800">
      <div className="max-w-6xl mx-auto flex pb-safe">
        {nav.map(({ href, label, icon: Icon, section: s }) => {
          const active = section === s
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

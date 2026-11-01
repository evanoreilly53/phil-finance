'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'
import { TRACK_TABS, activeTrackTab } from './nav'

/** Sub-navigation for the Track section: Spending · Income · Transactions · Accounts. */
export default function TrackTabs() {
  const active = activeTrackTab(usePathname())
  return (
    <nav aria-label="Track" className="-mx-4 px-4 overflow-x-auto">
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 min-w-max sm:min-w-0">
        {TRACK_TABS.map(t => {
          const on = active === t.href
          return (
            <Link key={t.href} href={t.href as Route} aria-current={on ? 'page' : undefined}
              className={`flex-1 text-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${on ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

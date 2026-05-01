'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LogOut, ChevronDown } from 'lucide-react'
import { signOut } from '@/app/auth/sign-out'

const titles: Record<string, string> = {
  '/dashboard':            'Dashboard',
  '/spending':             'Spending',
  '/networth':             'Net Worth',
  '/wedding':              'Wedding',
  '/goals':                'Goals',
  '/transactions':         'Transactions',
  '/transactions/import':  'Import CSV',
  '/insights':             'Insights',
  '/income':               'Income',
  '/settings':             'Settings',
}

export default function TopBar() {
  const pathname = usePathname()
  const title    = titles[pathname] ?? 'Bun & Chump'
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800 h-14 flex items-center px-4">
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
        <h1 className="text-white font-semibold text-lg">{title}</h1>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="App menu"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors font-mono"
          >
            <img src="/logo.png" alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" aria-hidden="true" />
            Bun & Chump
            <ChevronDown size={12} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div
                role="menu"
                className="absolute right-0 top-7 z-20 bg-gray-900 border border-gray-700 rounded-xl shadow-xl min-w-[140px] overflow-hidden"
              >
                <form action={signOut}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                    onClick={() => setMenuOpen(false)}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

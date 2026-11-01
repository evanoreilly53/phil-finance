import Link from 'next/link'
import type { Route } from 'next'
import type { AccountFreshness } from '@/lib/freshnessData'
import { agoLabel, worstFirst, type FreshnessStatus } from '@/lib/freshness'
import { fmtDate } from '@/lib/format'

export const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: 'bg-green-400',
  ageing: 'bg-amber-400',
  stale: 'bg-red-400',
  never: 'bg-gray-600',
}

/** Home's "data fresh to" line: one chip per account, worst first. */
export default function FreshnessStrip({ accounts }: { accounts: AccountFreshness[] }) {
  if (accounts.length === 0) return null
  const sorted = worstFirst(accounts)
  const behind = sorted.filter(a => a.status === 'stale' || a.status === 'never').length
  return (
    <Link href={'/track/accounts' as Route} className="block bg-gray-900 rounded-2xl border border-gray-800 p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Data fresh to</p>
        <span className={`text-xs ${behind ? 'text-amber-400' : 'text-gray-500'}`}>{behind ? `${behind} need updating →` : 'All current →'}</span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {sorted.map(a => (
          <li key={a.id} className="flex items-center gap-1.5 text-xs text-gray-300" title={a.dataAsOf ? `as of ${a.dataAsOf}` : 'never updated'}>
            <span className={`w-1.5 h-1.5 rounded-full ${FRESHNESS_DOT[a.status]}`} aria-hidden="true" />
            <span>{a.name}</span>
            <span className="text-gray-500">{a.dataAsOf ? fmtDate(a.dataAsOf, { day: 'numeric', month: 'short' }) : agoLabel(null)}</span>
            <span className="sr-only">({a.status})</span>
          </li>
        ))}
      </ul>
    </Link>
  )
}

'use client'

import { useState, useTransition, useId } from 'react'
import Link from 'next/link'
import { Check, ArrowLeftRight, Copy, Tag, X, Inbox } from 'lucide-react'
import { fmtAUD, fmtDate } from '@/lib/format'
import { reviewReasons, REVIEW_LABEL, suggestRulePattern, type ReviewReason } from '@/lib/review'
import type { ReviewFlag, CategoryKind } from '@/lib/supabase/database.types'
import { setReviewCategory, confirmTransfer, rejectTransfer, keepNotDuplicate, removeDuplicate } from './actions'

export type ReviewTx = {
  id: string
  date: string
  description: string
  amount_cents: number
  aud_amount_cents: number
  currency: string
  owner: string
  account_id: string | null
  category_id: string | null
  is_transfer: boolean
  transfer_account_id: string | null
  transfer_peer_id: string | null
  duplicate_of_id: string | null
  review_flags: ReviewFlag[]
  accounts: { name: string } | null
}
export type ReviewOriginal = { id: string; date: string; description: string; aud_amount_cents: number }
type Cat = { id: string; name: string; parent_id: string | null; kind: CategoryKind }
type Acct = { id: string; name: string; kind: 'asset' | 'liability' }

type Props = {
  rows: ReviewTx[]
  originals: ReviewOriginal[]
  categories: Cat[]
  accounts: Acct[]
  truncated: boolean
  lookbackDays: number
}

const TABS: { key: 'all' | ReviewReason; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'uncategorised', label: 'Category' },
  { key: 'suspected_transfer', label: 'Transfers' },
  { key: 'suspected_duplicate', label: 'Duplicates' },
]

export default function ReviewQueue({ rows, originals, categories, accounts, truncated, lookbackDays }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all')
  // Server actions revalidate this page, so resolved rows drop out on their own
  const withReasons = rows.map(r => ({ r, reasons: reviewReasons(r) })).filter(x => x.reasons.length > 0)
  const shown = tab === 'all' ? withReasons : withReasons.filter(x => x.reasons.includes(tab))
  const count = (k: ReviewReason) => withReasons.filter(x => x.reasons.includes(k)).length

  const origById = new Map(originals.map(o => [o.id, o]))
  const accName  = new Map(accounts.map(a => [a.id, a.name]))
  const parents  = new Map(categories.map(c => [c.id, c]))
  const catOptions = categories
    .filter(c => c.kind !== 'transfer')
    .map(c => ({ id: c.id, label: c.parent_id ? `${parents.get(c.parent_id)?.name ?? ''} › ${c.name}` : c.name }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/transactions" className="text-indigo-400 hover:text-indigo-300 text-sm">← Transactions</Link>
        <span className="text-gray-600">/</span>
        <span className="text-sm text-gray-300">Review</span>
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="tablist" aria-label="Filter review queue">
        {TABS.map(t => {
          const n = t.key === 'all' ? withReasons.length : count(t.key)
          return (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === t.key ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
              {t.label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {shown.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-10 text-center space-y-2">
          <Inbox size={36} className="text-gray-600 mx-auto" />
          <p className="text-white font-medium">All clear</p>
          <p className="text-xs text-gray-500">Nothing needs a look. Uncategorised rows older than {lookbackDays} days aren&apos;t listed.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map(({ r, reasons }) => (
            <ReviewCard key={r.id} tx={r} reasons={reasons} original={r.duplicate_of_id ? origById.get(r.duplicate_of_id) : undefined}
              catOptions={catOptions} accounts={accounts.filter(a => a.id !== r.account_id)} accName={accName} />
          ))}
        </ul>
      )}
      {truncated && <p className="text-xs text-gray-500 text-center">Showing the first 200. Clear some and reload for more.</p>}
    </div>
  )
}

function ReviewCard({ tx, reasons, original, catOptions, accounts, accName }: {
  tx: ReviewTx
  reasons: ReviewReason[]
  original?: ReviewOriginal
  catOptions: { id: string; label: string }[]
  accounts: Acct[]
  accName: Map<string, string>
}) {
  const uid = useId()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [cat, setCat] = useState('')
  const [learn, setLearn] = useState(true)
  const [toAccount, setToAccount] = useState(tx.transfer_account_id ?? '')
  const pattern = suggestRulePattern(tx.description)

  function run(fn: () => Promise<{ error?: string; rule?: string | null }>, after?: (r: { rule?: string | null }) => void) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res.error) { setError(res.error); return }
      after?.(res)
    })
  }

  const btn = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50'
  const sel = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <li className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white break-words">{tx.description}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{fmtDate(tx.date)} · {tx.accounts?.name ?? 'No account'}</p>
        </div>
        <span className={`text-sm font-semibold tabular-nums flex-shrink-0 ${tx.aud_amount_cents < 0 ? 'text-red-400' : 'text-green-400'}`}>
          {fmtAUD(tx.aud_amount_cents, { signed: true, full: true })}
          {tx.currency !== 'AUD' && <span className="block text-[10px] text-gray-500 font-normal text-right">{(tx.amount_cents / 100).toFixed(2)} {tx.currency}</span>}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {reasons.map(r => <span key={r} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{REVIEW_LABEL[r]}</span>)}
      </div>

      {reasons.includes('suspected_duplicate') && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Looks like {original
              ? <><span className="text-gray-200">{original.description}</span> on {fmtDate(original.date, { day: 'numeric', month: 'short' })} ({fmtAUD(original.aud_amount_cents, { signed: true, full: true })})</>
              : 'a row that was already here'}.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={pending} onClick={() => run(() => removeDuplicate(tx.id))} className={`${btn} bg-red-500/15 text-red-300 hover:bg-red-500/25`}><Copy size={12} /> Duplicate: remove</button>
            <button disabled={pending} onClick={() => run(() => keepNotDuplicate(tx.id))} className={`${btn} bg-gray-800 text-gray-200 hover:bg-gray-700`}><Check size={12} /> Keep both</button>
          </div>
        </div>
      )}

      {reasons.includes('suspected_transfer') && (
        <div className="space-y-2">
          <label htmlFor={`${uid}acct`} className="block text-xs text-gray-400">
            {tx.aud_amount_cents < 0 ? 'Moved to' : 'Came from'} which of your accounts?
          </label>
          <select id={`${uid}acct`} value={toAccount} onChange={e => setToAccount(e.target.value)} className={sel}>
            <option value="">Not sure / an account not in the app</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {tx.transfer_peer_id && tx.transfer_account_id && (
            <p className="text-[11px] text-gray-500">Matching amount found in {accName.get(tx.transfer_account_id) ?? 'another account'}.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button disabled={pending} onClick={() => run(() => confirmTransfer(tx.id, toAccount || null))} className={`${btn} bg-sky-500/20 text-sky-300 hover:bg-sky-500/30`}><ArrowLeftRight size={12} /> Yes, a transfer</button>
            <button disabled={pending} onClick={() => run(() => rejectTransfer(tx.id))} className={`${btn} bg-gray-800 text-gray-200 hover:bg-gray-700`}><X size={12} /> No, real spending</button>
          </div>
        </div>
      )}

      {reasons.includes('uncategorised') && (
        <div className="space-y-2">
          <label htmlFor={`${uid}cat`} className="sr-only">Category</label>
          <div className="flex gap-2">
            <select id={`${uid}cat`} value={cat} onChange={e => setCat(e.target.value)} className={sel}>
              <option value="">Choose a category…</option>
              {catOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <button disabled={pending || !cat} onClick={() => run(() => setReviewCategory(tx.id, cat, learn && !!pattern), r => r.rule && setNote(r.rule))}
              className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500 flex-shrink-0`}><Tag size={12} /> Save</button>
          </div>
          {pattern && (
            <label className="flex items-center gap-2 text-[11px] text-gray-400">
              <input type="checkbox" checked={learn} onChange={e => setLearn(e.target.checked)} className="accent-indigo-500" />
              Always use this for “{pattern.replace(/\\s\+/g, ' ')}”
            </label>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {note && <p className="text-xs text-green-400">Rule saved.</p>}
    </li>
  )
}

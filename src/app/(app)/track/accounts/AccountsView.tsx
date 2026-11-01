'use client'

import { useState, useId, useTransition } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { Plus, Upload, Pencil, TrendingUp } from 'lucide-react'
import Modal from '@/components/Modal'
import { fmtAUD, fmtDate } from '@/lib/format'
import { agoLabel } from '@/lib/freshness'
import type { AccountFreshness } from '@/lib/freshnessData'
import type { AccountType, ImportProfile } from '@/lib/supabase/database.types'
import { saveAccount, type AccountInput } from './actions'

export type AccountRow = Omit<AccountInput, 'id'> & {
  id: string
  kind: 'asset' | 'liability'
  balance: { date: string; cents: number } | null
  freshness: AccountFreshness | null
}

const TYPE_LABEL: Record<AccountType, string> = {
  bank: 'Bank', savings: 'Savings', offset: 'Offset', cash: 'Cash', investment: 'Investment', super: 'Super',
  property: 'Property', other_asset: 'Other asset', wedding: 'Wedding',
  credit_card: 'Credit card', mortgage: 'Mortgage', loan: 'Loan', other_liability: 'Other debt',
}
const DOT = { fresh: 'bg-green-400', ageing: 'bg-amber-400', stale: 'bg-red-400', never: 'bg-gray-600' } as const

export default function AccountsView({ accounts }: { accounts: AccountRow[] }) {
  const [editing, setEditing] = useState<AccountRow | 'new' | null>(null)
  const assets = accounts.filter(a => a.kind === 'asset')
  const debts  = accounts.filter(a => a.kind === 'liability')
  const sum = (xs: AccountRow[]) => xs.reduce((s, a) => s + (a.balance?.cents ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Link href={'/networth' as Route} className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium bg-gray-900 border border-gray-800 text-gray-300 hover:text-white">
          <TrendingUp size={15} /> Net worth &amp; balances
        </Link>
        <button onClick={() => setEditing('new')} className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500">
          <Plus size={15} /> Add account
        </button>
      </div>

      <Group title="Assets" total={sum(assets)} rows={assets} onEdit={setEditing} />
      {debts.length > 0 && <Group title="Debts" total={sum(debts)} rows={debts} onEdit={setEditing} />}

      <p className="text-xs text-gray-500 px-1">
        Freshness comes from your last CSV import or balance update. Everyday accounts go amber after a week and red after a month;
        super and investments after one and three months.
      </p>

      {editing && (
        <AccountModal
          account={editing === 'new' ? null : editing}
          offsetChoices={accounts.filter(a => a.kind === 'asset' && ['bank', 'savings', 'offset'].includes(a.type))}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function Group({ title, total, rows, onEdit }: { title: string; total: number; rows: AccountRow[]; onEdit: (a: AccountRow) => void }) {
  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-xs text-gray-500 uppercase tracking-wider">{title}</h2>
        <span className={`text-sm font-semibold tabular-nums ${total < 0 ? 'text-red-400' : 'text-white'}`}>{fmtAUD(total)}</span>
      </div>
      <ul className="divide-y divide-gray-800">
        {rows.map(a => {
          const f = a.freshness
          return (
            <li key={a.id} className="px-4 py-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[f?.status ?? 'never']}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{a.name}</p>
                <p className="text-[11px] text-gray-500 truncate">
                  {TYPE_LABEL[a.type]}{a.institution ? ` · ${a.institution}` : ''}{a.account_number_hint ? ` · xx${a.account_number_hint}` : ''}
                  {' · '}{f?.dataAsOf ? `fresh to ${fmtDate(f.dataAsOf, { day: 'numeric', month: 'short' })} (${agoLabel(f.days)})` : 'never updated'}
                  <span className="sr-only"> status {f?.status ?? 'never'}</span>
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm tabular-nums font-medium ${(a.balance?.cents ?? 0) < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                  {a.balance ? fmtAUD(a.balance.cents) : '—'}
                </p>
                <div className="flex gap-1 justify-end mt-1">
                  {a.import_profile && (
                    <Link href={`/transactions/import?account=${a.id}` as Route} aria-label={`Import CSV for ${a.name}`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"><Upload size={13} /></Link>
                  )}
                  <button onClick={() => onEdit(a)} aria-label={`Edit ${a.name}`} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"><Pencil size={13} /></button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function toNum(s: string): number | null {
  const n = Number(s)
  return s.trim() === '' || !Number.isFinite(n) ? null : n
}
function toCents(s: string): number | null {
  const n = toNum(s)
  return n === null ? null : Math.round(n * 100)
}

function AccountModal({ account, offsetChoices, onClose }: { account: AccountRow | null; offsetChoices: AccountRow[]; onClose: () => void }) {
  const uid = useId()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'bank' as AccountType,
    owner: account?.owner ?? 'joint' as AccountInput['owner'],
    currency: account?.currency ?? 'AUD',
    is_liquid: account?.is_liquid ?? true,
    institution: account?.institution ?? 'CommBank',
    account_number_hint: account?.account_number_hint ?? '',
    import_profile: (account ? account.import_profile ?? '' : 'commbank') as ImportProfile | '',
    interest_rate_pct: account?.interest_rate_pct?.toString() ?? '',
    offset_account_id: account?.offset_account_id ?? '',
    loan_original: account?.loan_original_cents != null ? String(account.loan_original_cents / 100) : '',
    loan_start_date: account?.loan_start_date ?? '',
    loan_term_months: account?.loan_term_months?.toString() ?? '',
    loan_repayment: account?.loan_repayment_cents != null ? String(account.loan_repayment_cents / 100) : '',
    loan_repayment_freq: account?.loan_repayment_freq ?? 'monthly',
    super_fund: account?.super_fund ?? '',
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }))
  const isLoan = f.type === 'mortgage' || f.type === 'loan'
  const isDebt = isLoan || f.type === 'credit_card' || f.type === 'other_liability'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const res = await saveAccount({
        id: account?.id,
        name: f.name, type: f.type, owner: f.owner, currency: f.currency, is_liquid: f.is_liquid,
        institution: f.institution || null,
        account_number_hint: f.account_number_hint || null,
        import_profile: f.import_profile || null,
        interest_rate_pct: toNum(f.interest_rate_pct),
        offset_account_id: f.offset_account_id || null,
        loan_original_cents: toCents(f.loan_original),
        loan_start_date: f.loan_start_date || null,
        loan_term_months: toNum(f.loan_term_months),
        loan_repayment_cents: toCents(f.loan_repayment),
        loan_repayment_freq: isLoan ? f.loan_repayment_freq : null,
        super_fund: f.super_fund || null,
      })
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const input = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl = 'block text-xs text-gray-400 mb-1.5'
  const field = (id: string, label: string, el: React.ReactNode) => (
    <div><label htmlFor={`${uid}${id}`} className={lbl}>{label}</label>{el}</div>
  )

  return (
    <Modal title={account ? `Edit ${account.name}` : 'Add account'} onClose={onClose}>
      <form onSubmit={submit} className="px-5 pb-8 pt-4 space-y-4">
        {field('name', 'Name', <input id={`${uid}name`} value={f.name} onChange={e => set('name', e.target.value)} className={input} required />)}
        <div className="grid grid-cols-2 gap-3">
          {field('type', 'Type', (
            <select id={`${uid}type`} value={f.type} onChange={e => set('type', e.target.value as AccountType)} className={input}>
              <optgroup label="Assets">{(['bank', 'savings', 'offset', 'cash', 'investment', 'super', 'property', 'other_asset', 'wedding'] as AccountType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</optgroup>
              <optgroup label="Debts">{(['credit_card', 'mortgage', 'loan', 'other_liability'] as AccountType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</optgroup>
            </select>
          ))}
          {field('owner', 'Owner', (
            <select id={`${uid}owner`} value={f.owner} onChange={e => set('owner', e.target.value as AccountInput['owner'])} className={input}>
              <option value="joint">Joint</option><option value="evan">Evan</option><option value="rachel">Rachel</option>
            </select>
          ))}
          {field('inst', 'Institution', <input id={`${uid}inst`} value={f.institution} onChange={e => set('institution', e.target.value)} className={input} placeholder="CommBank" />)}
          {field('cur', 'Currency', <input id={`${uid}cur`} value={f.currency} onChange={e => set('currency', e.target.value)} className={input} maxLength={3} />)}
          {field('hint', 'Last digits of account no.', <input id={`${uid}hint`} value={f.account_number_hint} onChange={e => set('account_number_hint', e.target.value)} className={input} inputMode="numeric" placeholder="e.g. 4821" />)}
          {field('profile', 'CSV import', (
            <select id={`${uid}profile`} value={f.import_profile} onChange={e => set('import_profile', e.target.value as ImportProfile | '')} className={input}>
              <option value="">No imports</option><option value="commbank">CommBank export</option><option value="generic">Other CSV</option>
            </select>
          ))}
          {field('rate', isDebt ? 'Interest rate % p.a.' : 'Interest rate % p.a. (optional)', <input id={`${uid}rate`} value={f.interest_rate_pct} onChange={e => set('interest_rate_pct', e.target.value)} className={input} inputMode="decimal" placeholder="e.g. 5.25" />)}
          {f.type === 'super' && field('fund', 'Super fund', <input id={`${uid}fund`} value={f.super_fund} onChange={e => set('super_fund', e.target.value)} className={input} />)}
        </div>
        <p className="text-[11px] text-gray-500">The last digits let the importer recognise “Transfer to xx4821” as money moving between your own accounts.</p>

        {!isDebt && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={f.is_liquid} onChange={e => set('is_liquid', e.target.checked)} className="accent-indigo-500" />
            Cash you can spend (counts towards liquid balance)
          </label>
        )}

        {isLoan && (
          <div className="grid grid-cols-2 gap-3 border-t border-gray-800 pt-4">
            {field('orig', 'Amount borrowed ($)', <input id={`${uid}orig`} value={f.loan_original} onChange={e => set('loan_original', e.target.value)} className={input} inputMode="decimal" />)}
            {field('start', 'Start date', <input id={`${uid}start`} type="date" value={f.loan_start_date} onChange={e => set('loan_start_date', e.target.value)} className={input} />)}
            {field('term', 'Term (months)', <input id={`${uid}term`} value={f.loan_term_months} onChange={e => set('loan_term_months', e.target.value)} className={input} inputMode="numeric" placeholder="360" />)}
            {field('rep', 'Repayment ($)', <input id={`${uid}rep`} value={f.loan_repayment} onChange={e => set('loan_repayment', e.target.value)} className={input} inputMode="decimal" />)}
            {field('freq', 'Repayment frequency', (
              <select id={`${uid}freq`} value={f.loan_repayment_freq} onChange={e => set('loan_repayment_freq', e.target.value as 'weekly' | 'fortnightly' | 'monthly')} className={input}>
                <option value="monthly">Monthly</option><option value="fortnightly">Fortnightly</option><option value="weekly">Weekly</option>
              </select>
            ))}
            {field('offset', 'Offset account', (
              <select id={`${uid}offset`} value={f.offset_account_id} onChange={e => set('offset_account_id', e.target.value)} className={input}>
                <option value="">None</option>
                {offsetChoices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ))}
          </div>
        )}
        {isDebt && <p className="text-[11px] text-gray-500">Debt balances are entered as the amount owed on the Net worth › Update balances screen.</p>}

        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={pending} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  )
}

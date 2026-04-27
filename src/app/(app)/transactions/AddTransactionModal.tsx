'use client'

import { useState, useId } from 'react'
import Modal from '@/components/Modal'
import { addTransaction, updateTransaction } from './actions'
import type { Category, Account, Transaction } from './TransactionList'

type Props = {
  categories: Category[]
  accounts: Account[]
  onClose: () => void
  onAdded: (id: string) => void
  editing?: Transaction
}

function perthToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date())
}

function blankForm() {
  return {
    date:          perthToday(),
    desc:          '',
    amount:        '',
    fxRate:        '',
    isExpense:     true,
    isLargeOneOff: false,
    categoryId:    '',
    accountId:     '',
    owner:         'joint' as const,
    notes:         '',
  }
}

export default function AddTransactionModal({ categories, accounts, onClose, onAdded, editing }: Props) {
  const uid = useId()
  const isEdit = !!editing

  const [form, setForm] = useState(() => {
    if (!editing) return blankForm()
    const isExp = editing.aud_amount_cents < 0
    return {
      date:          editing.date,
      desc:          editing.description,
      amount:        (Math.abs(editing.amount_cents) / 100).toFixed(2),
      fxRate:        editing.fx_rate ? String(editing.fx_rate) : '',
      isExpense:     isExp,
      isLargeOneOff: editing.is_large_one_off,
      categoryId:    editing.category_id ?? '',
      accountId:     editing.account_id,
      owner:         editing.owner,
      notes:         editing.notes ?? '',
    }
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  const { date, desc, amount, fxRate, isExpense, isLargeOneOff, categoryId, accountId, owner, notes } = form
  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  function handleAccountChange(id: string) {
    const acc = accounts.find(a => a.id === id)
    setForm(f => ({
      ...f,
      accountId: id,
      owner: (!isEdit && acc ? acc.owner : f.owner) as typeof f.owner,
    }))
  }

  const selectedAccount = accounts.find(a => a.id === accountId)
  const isNonAUD        = !!selectedAccount && selectedAccount.currency !== 'AUD'

  const parents  = categories.filter(c => !c.parent_id)
  const children = categories.filter(c => !!c.parent_id)
  const grouped  = parents.map(p => ({ parent: p, subs: children.filter(c => c.parent_id === p.id) }))


  async function submit(keepOpen = false) {
    if (!desc.trim() || !amount || !accountId || !categoryId) { setError('Fill in all required fields'); return }
    const parsedAmt = parseFloat(amount)
    if (isNaN(parsedAmt) || parsedAmt <= 0) { setError('Enter a valid amount'); return }
    if (isNonAUD && (!fxRate || isNaN(parseFloat(fxRate)))) { setError('Enter the exchange rate'); return }

    setSubmitting(true); setError('')
    const sign        = isExpense ? -1 : 1
    const rate        = isNonAUD ? parseFloat(fxRate) : 1
    const nativeCents = Math.round(parsedAmt * 100) * sign
    const audCents    = Math.round(parsedAmt * rate * 100) * sign
    const input = {
      date, description: desc.trim(),
      amount_cents: nativeCents, currency: selectedAccount?.currency ?? 'AUD',
      aud_amount_cents: audCents, fx_rate: rate,
      account_id: accountId, category_id: categoryId, owner, is_large_one_off: isLargeOneOff,
      notes: notes.trim() || undefined,
    }

    let result: { error?: string } | { id: string }
    if (isEdit && editing) {
      result = await updateTransaction(editing.id, input)
    } else {
      result = await addTransaction(input)
    }

    setSubmitting(false)
    if ('error' in result && result.error) { setError(result.error); return }

    if (keepOpen) {
      setForm(blankForm())
    } else {
      onAdded('id' in result ? result.id : '')
    }
  }

  const input = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl   = 'block text-xs font-medium text-gray-400 mb-1.5'

  return (
    <Modal title={isEdit ? 'Edit Transaction' : 'Add Transaction'} onClose={onClose} maxHeight="max-h-[90vh]">
      <div className="px-5 pb-8 space-y-4 pt-4">
        {/* Expense / Income toggle */}
        <div className="flex bg-gray-900 border border-gray-700 rounded-xl overflow-hidden text-sm" role="group" aria-label="Transaction type">
          <button type="button" onClick={() => set('isExpense', true)}
            aria-pressed={isExpense}
            className={`flex-1 py-2.5 font-medium transition-colors ${isExpense ? 'bg-red-600 text-white' : 'text-gray-400'}`}>Expense</button>
          <button type="button" onClick={() => set('isExpense', false)}
            aria-pressed={!isExpense}
            className={`flex-1 py-2.5 font-medium transition-colors ${!isExpense ? 'bg-green-600 text-white' : 'text-gray-400'}`}>Income</button>
        </div>

        <div className={`grid gap-3 ${isNonAUD ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <label htmlFor={`${uid}date`} className={lbl}>Date *</label>
            <input id={`${uid}date`} type="date" value={date} onChange={e => set('date', e.target.value)} required aria-required="true" className={input} />
          </div>
          <div>
            <label htmlFor={`${uid}amt`} className={lbl}>{isNonAUD ? `Amount (${selectedAccount?.currency})` : 'Amount ($)'} *</label>
            <input id={`${uid}amt`} type="number" min="0.01" step="0.01" placeholder="0.00"
              value={amount} onChange={e => set('amount', e.target.value)} required aria-required="true" className={input} inputMode="decimal" />
          </div>
          {isNonAUD && (
            <div>
              <label htmlFor={`${uid}fx`} className={lbl}>{selectedAccount?.currency}→AUD *</label>
              <input id={`${uid}fx`} type="number" min="0.0001" step="0.0001" placeholder="1.6500"
                value={fxRate} onChange={e => set('fxRate', e.target.value)} required aria-required="true" className={input} inputMode="decimal" />
            </div>
          )}
        </div>

        <div>
          <label htmlFor={`${uid}desc`} className={lbl}>Description *</label>
          <input id={`${uid}desc`} type="text" placeholder="What was this for?"
            value={desc} onChange={e => set('desc', e.target.value)} required aria-required="true" className={input} />
        </div>

        <div>
          <label htmlFor={`${uid}cat`} className={lbl}>Category *</label>
          <select id={`${uid}cat`} value={categoryId} onChange={e => set('categoryId', e.target.value)} required aria-required="true" className={input}>
            <option value="">Select category…</option>
            {grouped.map(({ parent, subs }) => (
              subs.length > 0 ? (
                <optgroup key={parent.id} label={parent.name}>
                  {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ) : (
                <option key={parent.id} value={parent.id}>{parent.name}</option>
              )
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}acct`} className={lbl}>Account *</label>
            <select id={`${uid}acct`} value={accountId} onChange={e => handleAccountChange(e.target.value)} required aria-required="true" className={input}>
              <option value="">Select…</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}{a.currency !== 'AUD' ? ` (${a.currency})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}own`} className={lbl}>Owner *</label>
            <select id={`${uid}own`} value={owner} onChange={e => set('owner', e.target.value)} className={input}>
              <option value="joint">Joint</option>
              <option value="rachel">Rachel</option>
              <option value="evan">Evan</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={isLargeOneOff} onChange={e => set('isLargeOneOff', e.target.checked)}
            className="w-4 h-4 rounded bg-gray-800 border-gray-600 accent-indigo-500" />
          <span className="text-sm text-gray-300">Large one-off expense</span>
        </label>

        <div>
          <label htmlFor={`${uid}notes`} className={lbl}>Notes</label>
          <input id={`${uid}notes`} type="text" placeholder="Optional note"
            value={notes} onChange={e => set('notes', e.target.value)} className={input} />
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button type="button" onClick={() => submit(false)} disabled={submitting}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 transition-colors text-sm">
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add Transaction'}
        </button>

        {!isEdit && (
          <button type="button" onClick={() => submit(true)} disabled={submitting}
            className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 font-medium rounded-xl py-3 transition-colors text-sm border border-gray-700">
            Save &amp; Add Another
          </button>
        )}
      </div>
    </Modal>
  )
}

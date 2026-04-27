'use client'

import { useState, useId } from 'react'
import Modal from '@/components/Modal'
import { addWeddingItem, updateWeddingItem } from './actions'
import type { WeddingItem } from './WeddingView'

type Props = {
  editing?: WeddingItem
  nextSortOrder?: number
  onClose: () => void
}

export default function WeddingItemModal({ editing, nextSortOrder = 0, onClose }: Props) {
  const uid    = useId()
  const isEdit = !!editing

  const [item,     setItem]     = useState(editing?.item ?? '')
  const [status,   setStatus]   = useState<WeddingItem['status']>(editing?.status ?? 'pending')
  const [budgetAud, setBudgetAud] = useState(editing?.budget_aud_cents != null ? String(editing.budget_aud_cents / 100) : '')
  const [budgetEur, setBudgetEur] = useState(editing?.budget_eur_cents != null ? String(editing.budget_eur_cents / 100) : '')
  const [spentAud,  setSpentAud]  = useState(editing?.spent_aud_cents  != null ? String(editing.spent_aud_cents  / 100) : '')
  const [spentEur,  setSpentEur]  = useState(editing?.spent_eur_cents  != null ? String(editing.spent_eur_cents  / 100) : '')
  const [owedEur,   setOwedEur]   = useState(editing?.balance_owed_eur_cents != null ? String(editing.balance_owed_eur_cents / 100) : '')
  const [notes,    setNotes]    = useState(editing?.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!item.trim()) { setError('Item name is required'); return }
    setSubmitting(true); setError('')

    const input = {
      item: item.trim(),
      status: status ?? 'pending',
      budget_aud_cents: budgetAud ? Math.round(parseFloat(budgetAud) * 100) : null,
      budget_eur_cents: budgetEur ? Math.round(parseFloat(budgetEur) * 100) : null,
      spent_aud_cents:  spentAud  ? Math.round(parseFloat(spentAud)  * 100) : null,
      spent_eur_cents:  spentEur  ? Math.round(parseFloat(spentEur)  * 100) : null,
      balance_owed_eur_cents: owedEur ? Math.round(parseFloat(owedEur) * 100) : null,
      notes: notes.trim() || null,
      sort_order: editing?.sort_order ?? nextSortOrder,
    }

    const result = isEdit && editing
      ? await updateWeddingItem(editing.id, input)
      : await addWeddingItem(input)

    setSubmitting(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl = 'block text-xs text-gray-400 mb-1'

  return (
    <Modal title={isEdit ? 'Edit Item' : 'Add Wedding Item'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-5 pb-8 pt-4 space-y-4">
        <div>
          <label htmlFor={`${uid}item`} className={lbl}>Item name *</label>
          <input id={`${uid}item`} value={item} onChange={e => setItem(e.target.value)} required aria-required="true" className={inp} placeholder="e.g. Flowers" />
        </div>

        <div>
          <label htmlFor={`${uid}status`} className={lbl}>Status</label>
          <select id={`${uid}status`} value={status ?? 'pending'} onChange={e => setStatus(e.target.value as WeddingItem['status'])} className={inp}>
            <option value="pending">Pending</option>
            <option value="deposit_paid">Deposit paid</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}baud`} className={lbl}>Budget AUD ($)</label>
            <input id={`${uid}baud`} type="number" min="0" step="0.01" value={budgetAud} onChange={e => setBudgetAud(e.target.value)} className={inp} inputMode="decimal" />
          </div>
          <div>
            <label htmlFor={`${uid}beur`} className={lbl}>Budget EUR (€)</label>
            <input id={`${uid}beur`} type="number" min="0" step="0.01" value={budgetEur} onChange={e => setBudgetEur(e.target.value)} className={inp} inputMode="decimal" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}saud`} className={lbl}>Spent AUD ($)</label>
            <input id={`${uid}saud`} type="number" min="0" step="0.01" value={spentAud} onChange={e => setSpentAud(e.target.value)} className={inp} inputMode="decimal" />
          </div>
          <div>
            <label htmlFor={`${uid}seur`} className={lbl}>Spent EUR (€)</label>
            <input id={`${uid}seur`} type="number" min="0" step="0.01" value={spentEur} onChange={e => setSpentEur(e.target.value)} className={inp} inputMode="decimal" />
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}owed`} className={lbl}>Balance owed EUR (€)</label>
          <input id={`${uid}owed`} type="number" min="0" step="0.01" value={owedEur} onChange={e => setOwedEur(e.target.value)} className={inp} inputMode="decimal" />
        </div>

        <div>
          <label htmlFor={`${uid}notes`} className={lbl}>Notes</label>
          <input id={`${uid}notes`} type="text" value={notes} onChange={e => setNotes(e.target.value)} className={inp} placeholder="Optional" />
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button type="submit" disabled={submitting}
          className="w-full bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 text-sm transition-colors">
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add Item'}
        </button>
      </form>
    </Modal>
  )
}

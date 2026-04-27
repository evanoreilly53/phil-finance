'use client'

import { useState, useId } from 'react'
import Modal from '@/components/Modal'
import { addPlannedOutflow, updatePlannedOutflow } from './actions'
import type { Outflow } from './GoalsView'

type Props = {
  editing?: Outflow
  onClose: () => void
}

export default function OutflowModal({ editing, onClose }: Props) {
  const uid    = useId()
  const isEdit = !!editing

  const [desc,      setDesc]      = useState(editing?.description ?? '')
  const [amount,    setAmount]    = useState(editing ? String(editing.amount_cents / 100) : '')
  const [dueDate,   setDueDate]   = useState(editing?.due_date ?? '')
  const [category,  setCategory]  = useState(editing?.category ?? '')
  const [notes,     setNotes]     = useState(editing?.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!desc.trim() || !amount || !dueDate) { setError('Description, amount and date are required'); return }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount'); return }

    setSubmitting(true); setError('')
    const input = {
      description: desc.trim(),
      amount_cents: Math.round(amt * 100),
      due_date: dueDate,
      category: category.trim() || null,
      notes: notes.trim() || null,
    }
    const result = isEdit && editing
      ? await updatePlannedOutflow(editing.id, input)
      : await addPlannedOutflow(input)

    setSubmitting(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl = 'block text-xs text-gray-400 mb-1'

  return (
    <Modal title={isEdit ? 'Edit Payment' : 'Add Planned Payment'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-5 pb-8 pt-4 space-y-4">
        <div>
          <label htmlFor={`${uid}desc`} className={lbl}>Description *</label>
          <input id={`${uid}desc`} value={desc} onChange={e => setDesc(e.target.value)} required aria-required="true" className={inp} placeholder="e.g. Venue deposit" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}amt`} className={lbl}>Amount ($) *</label>
            <input id={`${uid}amt`} type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required aria-required="true" className={inp} inputMode="decimal" />
          </div>
          <div>
            <label htmlFor={`${uid}date`} className={lbl}>Due date *</label>
            <input id={`${uid}date`} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required aria-required="true" className={inp} />
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}cat`} className={lbl}>Category</label>
          <input id={`${uid}cat`} value={category} onChange={e => setCategory(e.target.value)} className={inp} placeholder="e.g. Wedding" />
        </div>

        <div>
          <label htmlFor={`${uid}notes`} className={lbl}>Notes</label>
          <input id={`${uid}notes`} value={notes} onChange={e => setNotes(e.target.value)} className={inp} placeholder="Optional" />
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button type="submit" disabled={submitting}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 text-sm transition-colors">
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add Payment'}
        </button>
      </form>
    </Modal>
  )
}

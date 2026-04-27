'use client'

import { useState, useId } from 'react'
import Modal from '@/components/Modal'
import { addGoal, updateGoal, type GoalKind } from './actions'
import type { Goal } from './GoalsView'

type Props = {
  editing?: Goal
  onClose: () => void
}

export default function GoalModal({ editing, onClose }: Props) {
  const uid    = useId()
  const isEdit = !!editing

  const [name,       setName]       = useState(editing?.name ?? '')
  const [kind, setKind] = useState<GoalKind>((editing?.kind as GoalKind) ?? 'custom')
  const [owner, setOwner] = useState<'joint' | 'rachel' | 'evan'>(editing?.owner ?? 'joint')
  const [targetAmt,  setTargetAmt]  = useState(editing ? String(editing.target_cents / 100) : '')
  type Cadence = 'weekly' | 'monthly' | 'annual' | 'one-off' | null
  const [cadence, setCadence] = useState<Cadence>((editing?.cadence as Cadence) ?? null)
  const [targetDate, setTargetDate] = useState(editing?.target_date ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !targetAmt) { setError('Name and target are required'); return }
    const target = parseFloat(targetAmt)
    if (isNaN(target) || target <= 0) { setError('Enter a valid target amount'); return }

    setSubmitting(true); setError('')
    const input = {
      name: name.trim(),
      kind: (kind || null) as GoalKind,
      owner: owner as 'joint' | 'rachel' | 'evan',
      target_cents: Math.round(target * 100),
      cadence: cadence || null,
      target_date: targetDate || null,
    }
    const result = isEdit && editing
      ? await updateGoal(editing.id, input)
      : await addGoal(input)

    setSubmitting(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl = 'block text-xs text-gray-400 mb-1'

  return (
    <Modal title={isEdit ? 'Edit Goal' : 'Add Goal'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-5 pb-8 pt-4 space-y-4">
        <div>
          <label htmlFor={`${uid}name`} className={lbl}>Goal name *</label>
          <input id={`${uid}name`} value={name} onChange={e => setName(e.target.value)} required aria-required="true" className={inp} placeholder="e.g. Net Worth $500k" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}owner`} className={lbl}>Owner</label>
            <select id={`${uid}owner`} value={owner} onChange={e => setOwner(e.target.value as 'joint' | 'rachel' | 'evan')} className={inp}>
              <option value="joint">Joint</option>
              <option value="rachel">Rachel</option>
              <option value="evan">Evan</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}kind`} className={lbl}>Kind</label>
            <select id={`${uid}kind`} value={kind ?? 'custom'} onChange={e => setKind(e.target.value as GoalKind)} className={inp}>
              <option value="custom">Custom</option>
              <option value="net_worth_milestone">NW milestone</option>
              <option value="net_worth_ultimate">NW ultimate</option>
              <option value="weekly_savings">Weekly savings</option>
              <option value="annual_savings">Annual savings</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}target`} className={lbl}>Target amount ($) *</label>
          <input id={`${uid}target`} type="number" min="0.01" step="0.01" value={targetAmt} onChange={e => setTargetAmt(e.target.value)} required aria-required="true" className={inp} inputMode="decimal" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}cadence`} className={lbl}>Cadence</label>
            <select id={`${uid}cadence`} value={cadence ?? ''} onChange={e => setCadence((e.target.value as Cadence) || null)} className={inp}>
              <option value="">None</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="one-off">One-off</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}date`} className={lbl}>Target date</label>
            <input id={`${uid}date`} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={inp} />
          </div>
        </div>

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button type="submit" disabled={submitting}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 text-sm transition-colors">
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add Goal'}
        </button>
      </form>
    </Modal>
  )
}

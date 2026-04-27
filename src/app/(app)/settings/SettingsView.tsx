'use client'

import { useState, useId } from 'react'
import { Plus, Trash2, Pencil, Check, X, RefreshCw } from 'lucide-react'
import { updateSetting, addRule, updateRule, deleteRule, addRecurring, updateRecurring, deleteRecurring, postRecurring } from './actions'
import type { Category, Account } from '../transactions/TransactionList'
import { fmtAUD } from '@/lib/format'

type Rule = { id: string; pattern: string; category_id: string; owner: string | null; priority: number; is_active: boolean }
type RecurrenceFreq = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'
type Recurring = {
  id: string; description: string; amount_cents: number; currency: string
  category_id: string | null; account_id: string | null
  owner: 'joint' | 'rachel' | 'evan'; recurrence: RecurrenceFreq
  day_of_month: number | null; next_due: string; is_active: boolean; notes: string | null
}

type Tab = 'general' | 'rules' | 'recurring'

type Props = {
  settings: Record<string, unknown>
  rules: Rule[]
  recurring: Recurring[]
  categories: Category[]
  accounts: Account[]
}

function RuleModal({ categories, rule, onClose }: {
  categories: Category[]
  rule?: Rule
  onClose: () => void
}) {
  const uid = useId()
  const [pattern, setPattern]   = useState(rule?.pattern ?? '')
  const [catId, setCatId]       = useState(rule?.category_id ?? '')
  const [owner, setOwner]       = useState<string>(rule?.owner ?? '')
  const [priority, setPriority] = useState(String(rule?.priority ?? 0))
  const [active, setActive]     = useState(rule?.is_active ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const parents  = categories.filter(c => !c.parent_id)
  const children = categories.filter(c => !!c.parent_id)
  const grouped  = parents.map(p => ({ parent: p, subs: children.filter(c => c.parent_id === p.id) }))

  async function save() {
    if (!pattern.trim() || !catId) { setError('Pattern and category are required'); return }
    setSubmitting(true); setError('')
    const input = {
      pattern: pattern.trim(),
      category_id: catId,
      owner: (owner || null) as 'joint' | 'rachel' | 'evan' | null,
      priority: parseInt(priority) || 0,
      is_active: active,
    }
    const result = rule ? await updateRule(rule.id, input) : await addRule(input)
    if (result.error) { setError(result.error); setSubmitting(false); return }
    onClose()
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl = 'block text-xs font-medium text-gray-400 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-lg bg-gray-950 rounded-t-3xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">{rule ? 'Edit Rule' : 'Add Rule'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={20} /></button>
        </div>
        <div>
          <label htmlFor={`${uid}pat`} className={lbl}>Pattern (regex) *</label>
          <input id={`${uid}pat`} type="text" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="e.g. netflix|spotify" className={inp} />
        </div>
        <div>
          <label htmlFor={`${uid}cat`} className={lbl}>Category *</label>
          <select id={`${uid}cat`} value={catId} onChange={e => setCatId(e.target.value)} className={inp}>
            <option value="">Select…</option>
            {grouped.map(({ parent, subs }) =>
              subs.length > 0 ? (
                <optgroup key={parent.id} label={parent.name}>
                  {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ) : <option key={parent.id} value={parent.id}>{parent.name}</option>
            )}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}own`} className={lbl}>Owner (optional)</label>
            <select id={`${uid}own`} value={owner} onChange={e => setOwner(e.target.value)} className={inp}>
              <option value="">Any</option>
              <option value="joint">Joint</option>
              <option value="rachel">Rachel</option>
              <option value="evan">Evan</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}pri`} className={lbl}>Priority</label>
            <input id={`${uid}pri`} type="number" value={priority} onChange={e => setPriority(e.target.value)} className={inp} />
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 rounded accent-indigo-500" />
          <span className="text-sm text-gray-300">Active</span>
        </label>
        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
        <button onClick={save} disabled={submitting} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition-colors">
          {submitting ? 'Saving…' : 'Save rule'}
        </button>
      </div>
    </div>
  )
}

function RecurringModal({ categories, accounts, rec, onClose }: {
  categories: Category[]
  accounts: Account[]
  rec?: Recurring
  onClose: () => void
}) {
  const uid = useId()
  const [desc, setDesc]         = useState(rec?.description ?? '')
  const [amount, setAmount]     = useState(rec ? (Math.abs(rec.amount_cents) / 100).toFixed(2) : '')
  const [isExpense, setIsExpense] = useState(rec ? rec.amount_cents < 0 : true)
  const [currency] = useState(rec?.currency ?? 'AUD')
  const [catId, setCatId]       = useState(rec?.category_id ?? '')
  const [acctId, setAcctId]     = useState(rec?.account_id ?? '')
  const [owner, setOwner]       = useState<'joint'|'rachel'|'evan'>(rec?.owner ?? 'joint')
  const [recurrence, setRec]    = useState<RecurrenceFreq>(rec?.recurrence ?? 'monthly')
  const [nextDue, setNextDue]   = useState(rec?.next_due ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date()))
  const [active, setActive]     = useState(rec?.is_active ?? true)
  const [notes, setNotes]       = useState(rec?.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const parents  = categories.filter(c => !c.parent_id)
  const children = categories.filter(c => !!c.parent_id)
  const grouped  = parents.map(p => ({ parent: p, subs: children.filter(c => c.parent_id === p.id) }))

  async function save() {
    if (!desc.trim() || !amount || !acctId) { setError('Fill required fields'); return }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount'); return }
    setSubmitting(true); setError('')
    const sign = isExpense ? -1 : 1
    const input = {
      description: desc.trim(),
      amount_cents: Math.round(amt * 100) * sign,
      currency,
      category_id: catId || null,
      account_id: acctId || null,
      owner,
      recurrence: recurrence as Recurring['recurrence'],
      next_due: nextDue,
      is_active: active,
      notes: notes.trim() || null,
    }
    const result = rec ? await updateRecurring(rec.id, input) : await addRecurring(input)
    if (result.error) { setError(result.error); setSubmitting(false); return }
    onClose()
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl = 'block text-xs font-medium text-gray-400 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 overflow-y-auto">
      <div className="w-full max-w-lg bg-gray-950 rounded-t-3xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">{rec ? 'Edit Recurring' : 'Add Recurring'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={20} /></button>
        </div>
        <div className="flex bg-gray-900 border border-gray-700 rounded-xl overflow-hidden text-sm" role="group">
          <button type="button" onClick={() => setIsExpense(true)} aria-pressed={isExpense}
            className={`flex-1 py-2.5 font-medium transition-colors ${isExpense ? 'bg-red-600 text-white' : 'text-gray-400'}`}>Expense</button>
          <button type="button" onClick={() => setIsExpense(false)} aria-pressed={!isExpense}
            className={`flex-1 py-2.5 font-medium transition-colors ${!isExpense ? 'bg-green-600 text-white' : 'text-gray-400'}`}>Income</button>
        </div>
        <div>
          <label htmlFor={`${uid}desc`} className={lbl}>Description *</label>
          <input id={`${uid}desc`} type="text" value={desc} onChange={e => setDesc(e.target.value)} className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}amt`} className={lbl}>Amount *</label>
            <input id={`${uid}amt`} type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={inp} />
          </div>
          <div>
            <label htmlFor={`${uid}rec`} className={lbl}>Repeats *</label>
            <select id={`${uid}rec`} value={recurrence} onChange={e => setRec(e.target.value as RecurrenceFreq)} className={inp}>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}acct`} className={lbl}>Account *</label>
            <select id={`${uid}acct`} value={acctId} onChange={e => setAcctId(e.target.value)} className={inp}>
              <option value="">Select…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}own`} className={lbl}>Owner *</label>
            <select id={`${uid}own`} value={owner} onChange={e => setOwner(e.target.value as typeof owner)} className={inp}>
              <option value="joint">Joint</option>
              <option value="rachel">Rachel</option>
              <option value="evan">Evan</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${uid}cat`} className={lbl}>Category</label>
          <select id={`${uid}cat`} value={catId} onChange={e => setCatId(e.target.value)} className={inp}>
            <option value="">None</option>
            {grouped.map(({ parent, subs }) =>
              subs.length > 0 ? (
                <optgroup key={parent.id} label={parent.name}>
                  {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ) : <option key={parent.id} value={parent.id}>{parent.name}</option>
            )}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}due`} className={lbl}>Next due *</label>
          <input id={`${uid}due`} type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} className={inp} />
        </div>
        <div>
          <label htmlFor={`${uid}notes`} className={lbl}>Notes</label>
          <input id={`${uid}notes`} type="text" value={notes} onChange={e => setNotes(e.target.value)} className={inp} />
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 rounded accent-indigo-500" />
          <span className="text-sm text-gray-300">Active</span>
        </label>
        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
        <button onClick={save} disabled={submitting} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition-colors">
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function SettingsView({ settings, rules, recurring, categories, accounts }: Props) {
  const uid = useId()
  const [tab, setTab] = useState<Tab>('general')

  // General settings state
  const [income, setIncome]   = useState(String(Math.round((settings.monthly_income_cents as number ?? 1256300) / 100)))
  const [budget, setBudget]   = useState(String(Math.round((settings.personal_budget_cents as number ?? 80000) / 100)))
  const [wedding, setWedding] = useState(String(Math.round((settings.wedding_budget_cents as number ?? 7500000) / 100)))
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [savedGeneral, setSavedGeneral]   = useState(false)
  const [generalError, setGeneralError]   = useState('')

  async function saveGeneral() {
    setSavingGeneral(true); setGeneralError('')
    const results = await Promise.all([
      updateSetting('monthly_income_cents',  Math.round(parseFloat(income) * 100)),
      updateSetting('personal_budget_cents', Math.round(parseFloat(budget) * 100)),
      updateSetting('wedding_budget_cents',  Math.round(parseFloat(wedding) * 100)),
    ])
    const err = results.find(r => r.error)
    if (err?.error) setGeneralError(err.error)
    else { setSavedGeneral(true); setTimeout(() => setSavedGeneral(false), 2000) }
    setSavingGeneral(false)
  }

  // Rules
  const [editRule, setEditRule] = useState<Rule | undefined>()
  const [showAddRule, setShowAddRule] = useState(false)
  const [deletingRule, setDeletingRule] = useState<string | null>(null)

  async function handleDeleteRule(id: string) {
    setDeletingRule(id)
    await deleteRule(id)
    setDeletingRule(null)
  }

  // Recurring
  const [editRec, setEditRec]     = useState<Recurring | undefined>()
  const [showAddRec, setShowAddRec] = useState(false)
  const [postingId, setPostingId] = useState<string | null>(null)
  const [deletingRec, setDeletingRec] = useState<string | null>(null)

  async function handlePost(rec: Recurring) {
    setPostingId(rec.id)
    await postRecurring(rec as Parameters<typeof postRecurring>[0])
    setPostingId(null)
  }

  async function handleDeleteRec(id: string) {
    setDeletingRec(id)
    await deleteRecurring(id)
    setDeletingRec(null)
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl = 'block text-xs font-medium text-gray-400 mb-1.5'

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      {/* Tabs */}
      <div className="flex bg-gray-900 border border-gray-700 rounded-xl overflow-hidden text-sm">
        {(['general', 'rules', 'recurring'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 font-medium transition-colors capitalize ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* General tab */}
      {tab === 'general' && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Household Settings</p>
          <div>
            <label htmlFor={`${uid}income`} className={lbl}>Monthly household income ($)</label>
            <input id={`${uid}income`} type="number" value={income} onChange={e => setIncome(e.target.value)} className={inp} />
          </div>
          <div>
            <label htmlFor={`${uid}budget`} className={lbl}>Personal allowance per person ($/mo)</label>
            <input id={`${uid}budget`} type="number" value={budget} onChange={e => setBudget(e.target.value)} className={inp} />
          </div>
          <div>
            <label htmlFor={`${uid}wedding`} className={lbl}>Wedding budget ($)</label>
            <input id={`${uid}wedding`} type="number" value={wedding} onChange={e => setWedding(e.target.value)} className={inp} />
          </div>
          {generalError && <p role="alert" className="text-red-400 text-sm">{generalError}</p>}
          <button
            onClick={saveGeneral}
            disabled={savingGeneral}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition-colors flex items-center justify-center gap-2"
          >
            {savedGeneral ? <><Check size={16} /> Saved</> : savingGeneral ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}

      {/* Rules tab */}
      {tab === 'rules' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{rules.length} rule{rules.length !== 1 ? 's' : ''}</p>
            <button onClick={() => setShowAddRule(true)} className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
              <Plus size={14} /> Add rule
            </button>
          </div>

          {rules.length === 0 ? (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
              No rules yet. Add a rule to auto-categorise transactions by description.
            </div>
          ) : (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
              {rules.map(r => {
                const cat = categories.find(c => c.id === r.category_id)
                return (
                  <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-indigo-300 bg-gray-800 px-2 py-0.5 rounded">{r.pattern}</code>
                        {!r.is_active && <span className="text-xs text-gray-600">off</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        → {cat?.name ?? r.category_id}{r.owner ? ` · ${r.owner}` : ''} · priority {r.priority}
                      </p>
                    </div>
                    <button onClick={() => setEditRule(r)} className="text-gray-500 hover:text-gray-300 p-1"><Pencil size={14} /></button>
                    <button
                      onClick={() => handleDeleteRule(r.id)}
                      disabled={deletingRule === r.id}
                      className="text-red-500 hover:text-red-400 p-1 disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {(showAddRule || editRule) && (
            <RuleModal
              categories={categories}
              rule={editRule}
              onClose={() => { setShowAddRule(false); setEditRule(undefined) }}
            />
          )}
        </div>
      )}

      {/* Recurring tab */}
      {tab === 'recurring' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{recurring.length} scheduled</p>
            <button onClick={() => setShowAddRec(true)} className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
              <Plus size={14} /> Add
            </button>
          </div>

          {recurring.length === 0 ? (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
              No recurring transactions set up.
            </div>
          ) : (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
              {recurring.map(r => {
                const cat  = categories.find(c => c.id === r.category_id)
                const acct = accounts.find(a => a.id === r.account_id)
                const today = new Date().toISOString().slice(0, 10)
                const isDue = r.next_due <= today
                return (
                  <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white truncate">{r.description}</span>
                        {isDue && <span className="text-xs bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded-md">Due</span>}
                        {!r.is_active && <span className="text-xs text-gray-600">inactive</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {fmtAUD(r.amount_cents, { signed: true })} · {r.recurrence} · next {r.next_due}
                        {acct ? ` · ${acct.name}` : ''}{cat ? ` · ${cat.name}` : ''}
                      </p>
                    </div>
                    {isDue && (
                      <button
                        onClick={() => handlePost(r as Parameters<typeof handlePost>[0])}
                        disabled={postingId === r.id}
                        title="Post transaction now"
                        className="text-green-400 hover:text-green-300 p-1 disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={postingId === r.id ? 'animate-spin' : ''} />
                      </button>
                    )}
                    <button onClick={() => setEditRec(r)} className="text-gray-500 hover:text-gray-300 p-1"><Pencil size={14} /></button>
                    <button
                      onClick={() => handleDeleteRec(r.id)}
                      disabled={deletingRec === r.id}
                      className="text-red-500 hover:text-red-400 p-1 disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {(showAddRec || editRec) && (
            <RecurringModal
              categories={categories}
              accounts={accounts}
              rec={editRec}
              onClose={() => { setShowAddRec(false); setEditRec(undefined) }}
            />
          )}
        </div>
      )}
    </div>
  )
}

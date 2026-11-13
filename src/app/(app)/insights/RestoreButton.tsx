'use client'

import { useState, useTransition } from 'react'
import { setInsightState } from './actions'

/** Bring a done / snoozed / intentional insight back. */
export default function RestoreButton({ insightKey }: { insightKey: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="flex-shrink-0">
      <button type="button" disabled={pending} className="text-indigo-400 disabled:opacity-50"
        onClick={() => start(async () => { const r = await setInsightState(insightKey, { kind: 'clear' }); if (r.error) setError(r.error) })}>
        {pending ? '…' : 'Bring back'}
      </button>
      {error && <span role="alert" className="block text-red-400">{error}</span>}
    </span>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { setHouseBought } from './actions'

/** "We've bought it" / "Not bought yet": switches Home and House into (or out of) Home Loan mode. */
export default function BoughtToggle({ eventId, bought }: { eventId: string; bought: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" disabled={pending}
        onClick={() => {
          if (!bought && !window.confirm('Mark the house as bought? Home and House switch to tracking the mortgage. You can undo this.')) return
          setError(null)
          start(async () => { const r = await setHouseBought(eventId, !bought); if (r.error) setError(r.error) })
        }}
        className={`text-xs px-3 py-1.5 rounded-lg border disabled:opacity-50 ${bought ? 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white' : 'bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500'}`}>
        {pending ? 'Saving…' : bought ? 'Not bought yet (undo)' : 'We’ve bought it'}
      </button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

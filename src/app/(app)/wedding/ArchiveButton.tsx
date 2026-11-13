'use client'

import { useState, useTransition } from 'react'
import { setWeddingArchived } from './actions'

export default function ArchiveButton({ archive, label }: { archive: boolean; label: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="flex-shrink-0 text-right">
      <button type="button" disabled={pending}
        onClick={() => start(async () => { const r = await setWeddingArchived(archive); if (r.error) setError(r.error) })}
        className={`text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 ${archive ? 'bg-indigo-600 text-white' : 'border border-gray-700 text-gray-300'}`}>
        {pending ? 'Saving…' : label}
      </button>
      {error && <span role="alert" className="block text-[11px] text-red-400 mt-1">{error}</span>}
    </span>
  )
}

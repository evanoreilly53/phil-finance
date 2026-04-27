'use client'

import { useState } from 'react'
import { X, Lightbulb, AlertTriangle } from 'lucide-react'

export type AdviceCard = {
  id: string
  title: string
  body: string
  type: 'warning' | 'info'
}

const STORAGE_KEY = 'phil-dismissed-advice'

function readDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

export default function AdviceCards({ cards }: { cards: AdviceCard[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed)

  function dismiss(id: string) {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }
  const visible = cards.filter(c => !dismissed.has(c.id))
  if (!visible.length) return null

  return (
    <div className="space-y-2">
      {visible.map(card => (
        <div
          key={card.id}
          className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${
            card.type === 'warning'
              ? 'bg-yellow-500/10 border-yellow-500/30'
              : 'bg-blue-500/10 border-blue-500/30'
          }`}
        >
          <div className="flex-shrink-0 mt-0.5">
            {card.type === 'warning'
              ? <AlertTriangle size={14} className="text-yellow-400" />
              : <Lightbulb    size={14} className="text-blue-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${card.type === 'warning' ? 'text-yellow-300' : 'text-blue-300'}`}>
              {card.title}
            </p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{card.body}</p>
          </div>
          <button
            onClick={() => dismiss(card.id)}
            className="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

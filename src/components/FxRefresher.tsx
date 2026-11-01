'use client'

import { useEffect } from 'react'

const KEY = 'fx-refresh-requested'

/**
 * Asks the server to refresh FX rates at most once per browser session.
 * Fire-and-forget: renders nothing, never blocks a page, ignores failures.
 */
export default function FxRefresher() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) return
      sessionStorage.setItem(KEY, '1')
    } catch {
      // storage unavailable (private mode): the server's 12h guard still limits fetches
    }
    fetch('/api/fx/refresh', { method: 'POST' }).catch(() => {})
  }, [])
  return null
}

'use client'

import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('pwa-dismissed')) return

    function handler(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setDismissed(false)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (dismissed || !deferredPrompt) return null

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') localStorage.setItem('pwa-dismissed', '1')
    setDismissed(true)
  }

  function dismiss() {
    localStorage.setItem('pwa-dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-24 left-4 right-4 z-30 bg-gray-800 border border-indigo-700 rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3">
      <Download size={18} className="text-indigo-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">Add to Home Screen</p>
        <p className="text-xs text-gray-400 mt-0.5">Install Bun & Chump for quick access</p>
      </div>
      <button onClick={install} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex-shrink-0">
        Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="text-gray-500 hover:text-gray-300 flex-shrink-0">
        <X size={16} />
      </button>
    </div>
  )
}

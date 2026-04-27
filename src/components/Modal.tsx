'use client'

import { useEffect, useRef, useId } from 'react'
import { X } from 'lucide-react'

type Props = {
  title: string
  onClose: () => void
  children: React.ReactNode
  maxHeight?: string
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function getFocusable(el: HTMLElement | null): HTMLElement[] {
  return el ? Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
}

export default function Modal({ title, onClose, children, maxHeight = 'max-h-[92vh]' }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId   = useId()

  // Restore focus to the element that opened this modal
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    return () => { prev?.focus() }
  }, [])

  // Auto-focus first focusable element on mount
  useEffect(() => {
    const first = getFocusable(dialogRef.current)[0]
    first?.focus()
  }, [])

  // ESC to close + focus trap
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const focusable = getFocusable(dialogRef.current)
      if (!focusable.length) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      {/* Single backdrop — aria-hidden so screen readers see only the dialog */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative bg-gray-950 border-t border-gray-800 rounded-t-3xl ${maxHeight} overflow-y-auto`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 sticky top-0 bg-gray-950 border-b border-gray-800/50 z-10">
          <h2 id={titleId} className="text-base font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { FileDown } from 'lucide-react'
import { monthLabel } from '@/lib/format'
import { getMonthlyReport } from './report'

/**
 * "Download monthly report (PDF)". The server assembles the numbers; the PDF
 * is drawn here in the browser (the PDF library loads only on click), so it
 * works the same on Vercel and offline-ish phones, with no fonts to bundle.
 */
export default function ReportButton({ months }: { months: string[] }) {
  const [month, setMonth] = useState(months[0] ?? '')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function download() {
    setError(null)
    start(async () => {
      const r = await getMonthlyReport(month)
      if (!r.report) { setError(r.error ?? 'The report could not be made'); return }
      try {
        const { reportBlob } = await import('@/lib/report/pdf')
        const blob = await reportBlob(r.report, `${window.location.origin}/logo.png`)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `bun-and-chump-report-${month}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      } catch (e) {
        setError(e instanceof Error ? `The PDF could not be drawn: ${e.message}` : 'The PDF could not be drawn')
      }
    })
  }

  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-2" aria-labelledby="report-h">
      <h2 id="report-h" className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider"><FileDown size={14} /> Monthly report</h2>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="report-month" className="sr-only">Month</label>
        <select id="report-month" value={month} onChange={e => setMonth(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-2 py-1.5">
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button type="button" onClick={download} disabled={pending || !month}
          className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium">
          {pending ? 'Making the PDF…' : 'Download monthly report (PDF)'}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <p className="text-[11px] text-gray-500">1–3 printable pages: net worth and why it moved, income vs spending, budgets, top insights, bills, the deposit (or home loan) and super cap room. Estimates, not financial advice.</p>
    </section>
  )
}

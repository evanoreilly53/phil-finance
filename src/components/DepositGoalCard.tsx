import Link from 'next/link'
import type { Route } from 'next'
import { Home } from 'lucide-react'
import { fmtAUD, fmtCompact, monthLabel } from '@/lib/format'
import type { DepositGoal } from '@/lib/projection/load'

const mon = (mk: string) => monthLabel(mk, { month: 'short', year: 'numeric' })

/** House deposit progress with the projected date and the monthly gap. Used on Home and Future. */
export default function DepositGoalCard({ goal, href = '/future' }: { goal: DepositGoal; href?: string }) {
  const pct = goal.targetCents > 0 ? Math.max(0, Math.min(100, (goal.currentCents / goal.targetCents) * 100)) : 0
  const late = goal.monthsLate
  const status = goal.projectedMonth === 'now' || (late !== null && late <= 0) ? 'on' : late !== null && late <= 3 ? 'near' : 'off'
  const statusText =
    goal.projectedMonth === 'now' ? 'Reached'
      : goal.projectedMonth === null ? 'Not reached in the projection'
        : late === 0 ? 'On time'
          : late! < 0 ? `${-late!} month${late === -1 ? '' : 's'} early`
            : `${late} month${late === 1 ? '' : 's'} behind`

  return (
    <Link href={href as Route} className="block bg-gray-900 rounded-2xl border border-gray-800 p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
        <Home size={13} /> House deposit
      </div>
      <div className="flex items-baseline justify-between mt-2 gap-3">
        <p className="text-white text-lg font-semibold tabular-nums">{fmtCompact(goal.currentCents)} <span className="text-gray-500 text-sm font-normal">of {fmtCompact(goal.targetCents)}</span></p>
        <p className="text-sm text-gray-300 tabular-nums">{Math.round(pct)}%</p>
      </div>
      <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden mt-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="House deposit progress">
        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-gray-300 mt-3">
        {goal.projectedMonth && goal.projectedMonth !== 'now'
          ? <>Projected: <span className="text-white font-medium">{mon(goal.projectedMonth)}</span> (target {mon(goal.byMonth)})</>
          : <>Target {mon(goal.byMonth)}</>}
        {' · '}
        <span className={status === 'on' ? 'text-green-400' : status === 'near' ? 'text-amber-400' : 'text-red-400'}>{statusText}</span>
      </p>
      {goal.extraMonthlyCents ? (
        <p className="text-sm text-indigo-300 mt-1">+{fmtAUD(goal.extraMonthlyCents)}/mo closes the gap</p>
      ) : goal.extraMonthlyCents === 0 && goal.projectedMonth !== 'now' ? (
        <p className="text-xs text-gray-500 mt-1">No extra saving needed on the current plan.</p>
      ) : null}
      {goal.fhss && (
        <p className="text-xs text-gray-400 mt-1">Includes about {fmtAUD(goal.fhss.netCents)} FHSS release (after tax, estimate) in {mon(goal.fhss.month)}.</p>
      )}
      <p className="text-[11px] text-gray-500 mt-2">
        Deposit + duty + costs for &ldquo;{goal.eventName}&rdquo;. Counts the accounts ticked in Assumptions; super isn&apos;t included{goal.fhss ? ' except the FHSS release' : ''}.
      </p>
    </Link>
  )
}

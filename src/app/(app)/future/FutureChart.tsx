'use client'

import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine,
} from 'recharts'
import ChartTooltip from '@/components/ChartTooltip'
import type { ChartPoint } from '@/lib/projection/present'

type Pin = { month: string; label: string; name: string; done: boolean }

/** Phase 5: p10 / p50 / p90 of net worth per point (whole dollars), same order as `points`. */
export type BandSeries = { p10: number; p50: number; p90: number }[]

type Props = {
  points: ChartPoint[]
  pins: Pin[]
  years: number
  selected: string | null
  /** Extra query to keep when opening a month (e.g. the scenario). */
  query?: string
  band?: BandSeries | null
}

const SERIES = [
  { key: 'netWorth', name: 'Net worth', colour: '#f9a8d4' },
  { key: 'liquid',   name: 'Cash',      colour: '#60a5fa' },
  { key: 'super',    name: 'Super',     colour: '#34d399' },
] as const

/** Projected net worth / cash / super. Tap a month to open its ledger below. */
export default function FutureChart({ points, pins, years, selected, query = '', band = null }: Props) {
  const router = useRouter()
  const selectedLabel = points.find(p => p.month === selected)?.label
  const last = points[points.length - 1]
  const data = band ? points.map((p, i) => ({ ...p, nwRange: band[i] ? [band[i].p10, band[i].p90] : undefined, nwMid: band[i]?.p50 })) : points
  const lastBand = band?.[band.length - 1]

  function open(month: string | undefined) {
    if (!month || month === 'now') return
    router.push(`/future?years=${years}${query}&m=${month}#ledger` as Route, { scroll: false })
  }

  return (
    <>
      <p className="sr-only">
        {`Projected net worth, cash and super, monthly for ${years} years. `}
        {last && `In ${last.label}: net worth $${last.netWorth.toLocaleString('en-AU')}, cash $${last.liquid.toLocaleString('en-AU')}, super $${last.super.toLocaleString('en-AU')}.`}
        {last && lastBand && ` Range for net worth (10th to 90th percentile): $${lastBand.p10.toLocaleString('en-AU')} to $${lastBand.p90.toLocaleString('en-AU')}.`}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={data}
          margin={{ top: 16, right: 8, bottom: 0, left: -12 }}
          onClick={(e: unknown) => {
            const idx = (e as { activeTooltipIndex?: number | string } | null)?.activeTooltipIndex
            const i = typeof idx === 'string' ? Number(idx) : idx
            open(typeof i === 'number' && Number.isFinite(i) ? points[i]?.month : undefined)
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={24} />
          <YAxis
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={v => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}k`)}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {pins.map(p => (
            <ReferenceLine key={p.month + p.name} x={p.label} stroke={p.done ? '#6b7280' : '#fbbf24'} strokeDasharray="3 3"
              label={{ value: p.name, position: 'insideTopLeft', fill: p.done ? '#9ca3af' : '#fbbf24', fontSize: 9 }} />
          ))}
          {selectedLabel && <ReferenceLine x={selectedLabel} stroke="#a5b4fc" strokeWidth={2} />}
          {band && (
            <Area type="monotone" dataKey="nwRange" name="Net worth range (p10–p90)" stroke="none" fill="#f9a8d4" fillOpacity={0.15}
              isAnimationActive={false} activeDot={false} />
          )}
          {band && (
            <Line type="monotone" dataKey="nwMid" name="Net worth middle (p50)" stroke="#f9a8d4" strokeDasharray="4 3" strokeWidth={1}
              dot={false} isAnimationActive={false} />
          )}
          {SERIES.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.colour}
              strokeWidth={s.key === 'netWorth' ? 2 : 1.5} dot={false} isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-gray-500 mt-1">Tap the chart to see any month&apos;s ledger.</p>
    </>
  )
}

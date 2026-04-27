'use client'

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ReferenceLine,
} from 'recharts'
import ChartTooltip from '@/components/ChartTooltip'
import type { Milestone } from '@/lib/forecast'

const CHART_GROUPS = [
  { key: 'investments', label: 'Investments', colour: '#818cf8' },
  { key: 'super',       label: 'Super',       colour: '#34d399' },
  { key: 'bank',        label: 'Bank',        colour: '#60a5fa' },
] as const

type Props = {
  // Historical data (have 'total'; projected points have 'projected_total')
  mergedData: Record<string, number | string>[]
  showTotal:  boolean
  milestones: Milestone[]
}

export default function NetWorthChart({ mergedData, showTotal, milestones }: Props) {
  const first  = mergedData[0]
  const latest = mergedData.find(d => d.total != null)
  const hasProjection = mergedData.some(d => d.projected_total != null)

  return (
    <>
      <p className="sr-only">
        {`Net worth history line chart with ${mergedData.length} data points`}
        {first && latest && ` from ${first.label} to ${mergedData[mergedData.length - 1].label}`}
        {latest?.total != null && `. Latest total: $${(latest.total as number).toLocaleString('en-AU')}`}.
        {hasProjection && ' Includes 12-month projection.'}
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={mergedData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
          <YAxis
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {/* Milestone reference lines */}
          {milestones.map(m => {
            const point = mergedData.find(d => (d.date as string)?.startsWith(m.date.slice(0, 7)))
            if (!point) return null
            return (
              <ReferenceLine
                key={m.dollars}
                x={point.label as string}
                stroke="#fbbf24"
                strokeDasharray="2 2"
                label={{ value: m.label, position: 'insideTopRight', fill: '#fbbf24', fontSize: 9 }}
              />
            )
          })}

          {/* Historical: solid lines */}
          {showTotal && (
            <Line type="monotone" dataKey="total" name="Total" stroke="#f9a8d4" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          )}
          {CHART_GROUPS.map(g => (
            <Line key={g.key} type="monotone" dataKey={g.key} name={g.label}
              stroke={g.colour} strokeWidth={1.5} dot={{ r: 2 }} connectNulls={false} />
          ))}

          {/* Projected: dashed total line */}
          {showTotal && hasProjection && (
            <Line type="monotone" dataKey="projected_total" name="Projected"
              stroke="#f9a8d4" strokeWidth={1.5} strokeDasharray="5 3"
              dot={false} connectNulls={false} legendType="none" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}

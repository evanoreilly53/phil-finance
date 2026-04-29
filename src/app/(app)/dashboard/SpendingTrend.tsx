'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts'
import ChartTooltip from '@/components/ChartTooltip'
import { Card } from '@/components/Card'

type SpendEntry = { label: string; totalSpend: number }

type Props = {
  data: SpendEntry[]
}

export default function SpendingTrend({ data }: Props) {
  if (data.length === 0) return null

  const avg = Math.round(data.reduce((s, d) => s + d.totalSpend, 0) / data.length)

  return (
    <Card padded={false} className="p-4">
      <p className="text-sm font-semibold text-white mb-3">6-Month Spending</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
          <YAxis
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)}
          />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine
            y={avg}
            stroke="#6b7280"
            strokeDasharray="4 4"
            label={{ value: 'avg', position: 'insideTopRight', fontSize: 9, fill: '#6b7280' }}
          />
          <Bar dataKey="totalSpend" name="Spending" fill="#f87171" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
} from 'recharts'
import ChartTooltip from '@/components/ChartTooltip'
import { Card } from '@/components/Card'
import type { Transaction } from './TransactionList'

const FALLBACK_COLOURS = ['#818cf8','#34d399','#f87171','#fbbf24','#60a5fa','#a78bfa','#f472b6','#fb923c']

type Props = {
  transactions: Transaction[]
}

export default function SpendSummary({ transactions }: Props) {
  const categories = useMemo(() => {
    const totals = new Map<string, { name: string; cents: number; colour: string }>()
    for (const t of transactions) {
      if (t.aud_amount_cents >= 0) continue
      const name = t.categories?.name ?? 'Uncategorised'
      const colour = t.categories?.colour ?? '#6b7280'
      const existing = totals.get(name)
      if (existing) {
        existing.cents += Math.abs(t.aud_amount_cents)
      } else {
        totals.set(name, { name, cents: Math.abs(t.aud_amount_cents), colour })
      }
    }
    return [...totals.values()]
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 8)
  }, [transactions])

  if (categories.length === 0) return null

  const chartData = categories.map(c => ({
    name: c.name.length > 16 ? c.name.slice(0, 15) + '…' : c.name,
    spend: Math.round(c.cents / 100),
    colour: c.colour,
  }))

  const chartHeight = Math.max(120, categories.length * 28)

  return (
    <Card padded={false} className="p-4">
      <p className="text-sm font-semibold text-white mb-3">Spending This Period</p>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 8 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            width={90}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="spend" name="Spend" radius={[0, 3, 3, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.colour !== '#6b7280' ? d.colour : FALLBACK_COLOURS[i % FALLBACK_COLOURS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

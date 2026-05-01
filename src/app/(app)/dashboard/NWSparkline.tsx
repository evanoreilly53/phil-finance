'use client'

import { ResponsiveContainer, LineChart, Line } from 'recharts'

type Props = {
  points: { date: string; total: number }[]
}

export default function NWSparkline({ points }: Props) {
  if (points.length < 2) return null

  const first  = points[0].total
  const latest = points[points.length - 1].total
  const colour = latest >= first ? '#4ade80' : '#f87171'

  return (
    <div className="mt-2 mb-1" aria-hidden="true">
      <ResponsiveContainer width="100%" height={72}>
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="total"
            stroke={colour}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

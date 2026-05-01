'use client'

import { ResponsiveContainer, AreaChart, Area } from 'recharts'

type Props = {
  points: { date: string; total: number }[]
}

export default function NWSparkline({ points }: Props) {
  if (points.length < 2) return null

  const first  = points[0].total
  const latest = points[points.length - 1].total
  const colour = latest >= first ? '#4ade80' : '#f87171'
  const gradId = latest >= first ? 'nwGradGreen' : 'nwGradRed'

  return (
    <div className="mt-2 mb-1" aria-hidden="true">
      <ResponsiveContainer width="100%" height={72}>
        <AreaChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={colour} stopOpacity={0.3} />
              <stop offset="95%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="total"
            stroke={colour}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

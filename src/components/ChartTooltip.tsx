type PayloadItem = {
  name: string
  value: number
  fill?: string
  stroke?: string
  color?: string
}

type Props = {
  active?: boolean
  payload?: PayloadItem[]
  label?: string
  formatValue?: (n: number) => string
}

export default function ChartTooltip({ active, payload, label, formatValue }: Props) {
  if (!active || !payload?.length) return null
  const fmt = formatValue ?? ((n: number) => '$' + n.toLocaleString('en-AU'))
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs shadow-xl space-y-1">
      {label && <p className="text-gray-400 font-medium">{label}</p>}
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: p.fill ?? p.stroke ?? p.color ?? '#6b7280' }}
          />
          <span className="text-gray-300">{p.name}:</span>
          <span className="text-white font-medium">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

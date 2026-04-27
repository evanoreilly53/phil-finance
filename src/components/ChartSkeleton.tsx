export default function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div
      className="w-full bg-gray-800/50 rounded-xl animate-pulse"
      style={{ height }}
    />
  )
}

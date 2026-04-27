export function SkeletonCard({ height = 'h-32', className = '' }: { height?: string; className?: string }) {
  return (
    <div className={`bg-gray-900 rounded-2xl border border-gray-800 ${height} animate-pulse ${className}`} />
  )
}

export function SkeletonLine({ width = 'w-1/2', className = '' }: { width?: string; className?: string }) {
  return <div className={`h-3 bg-gray-800 rounded-full animate-pulse ${width} ${className}`} />
}

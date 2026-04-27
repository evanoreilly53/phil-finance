import { SkeletonCard, SkeletonLine } from '@/components/Skeleton'

export default function ImportLoading() {
  return (
    <div className="space-y-4">
      <SkeletonLine className="h-4 w-48" />
      <SkeletonLine className="h-3 w-64" />
      <SkeletonCard className="h-48" />
    </div>
  )
}

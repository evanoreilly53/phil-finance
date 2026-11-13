import { SkeletonCard, SkeletonLine } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonLine className="h-7 w-28" />
      <SkeletonCard className="h-56" />
      <SkeletonCard className="h-64" />
    </div>
  )
}

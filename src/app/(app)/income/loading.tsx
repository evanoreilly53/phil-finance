import { SkeletonCard, SkeletonLine } from '@/components/Skeleton'

export default function IncomeLoading() {
  return (
    <div className="space-y-4">
      <SkeletonLine className="h-7 w-24" />
      <div className="grid grid-cols-2 gap-3">
        <SkeletonCard className="h-28" />
        <SkeletonCard className="h-28" />
      </div>
      <SkeletonCard className="h-20" />
      <SkeletonCard className="h-64" />
    </div>
  )
}

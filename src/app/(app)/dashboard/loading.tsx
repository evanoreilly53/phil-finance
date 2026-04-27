import { SkeletonCard } from '@/components/Skeleton'

export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <SkeletonCard height="h-28" />
      <div className="grid grid-cols-2 gap-3">
        <SkeletonCard height="h-24" />
        <SkeletonCard height="h-24" />
        <SkeletonCard height="h-24" />
        <SkeletonCard height="h-24" />
      </div>
      <SkeletonCard height="h-48" />
    </div>
  )
}

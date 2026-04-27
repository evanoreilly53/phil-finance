import { SkeletonCard } from '@/components/Skeleton'

export default function NetWorthLoading() {
  return (
    <div className="space-y-4 pb-4">
      <SkeletonCard height="h-28" />
      <SkeletonCard height="h-32" />
      <SkeletonCard height="h-64" />
      <SkeletonCard height="h-72" />
    </div>
  )
}

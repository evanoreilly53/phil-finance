import { SkeletonCard } from '@/components/Skeleton'

export default function InsightsLoading() {
  return (
    <div className="space-y-4 pb-4">
      <SkeletonCard height="h-12" />
      <SkeletonCard height="h-48" />
      <SkeletonCard height="h-32" />
      <SkeletonCard height="h-56" />
      <SkeletonCard height="h-52" />
      <SkeletonCard height="h-36" />
    </div>
  )
}

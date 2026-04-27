import { SkeletonCard } from '@/components/Skeleton'

export default function SpendingLoading() {
  return (
    <div className="space-y-4 pb-4">
      <SkeletonCard height="h-12" />
      <SkeletonCard height="h-10" />
      <SkeletonCard height="h-24" />
      <SkeletonCard height="h-56" />
      <SkeletonCard height="h-48" />
    </div>
  )
}

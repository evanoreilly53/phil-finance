import { SkeletonCard } from '@/components/Skeleton'

export default function GoalsLoading() {
  return (
    <div className="space-y-4 pb-4">
      <SkeletonCard height="h-32" />
      <SkeletonCard height="h-32" />
      <SkeletonCard height="h-32" />
      <SkeletonCard height="h-48" />
    </div>
  )
}

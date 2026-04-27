import { SkeletonCard } from '@/components/Skeleton'

export default function WeddingLoading() {
  return (
    <div className="space-y-4 pb-4">
      <SkeletonCard height="h-32" />
      <SkeletonCard height="h-20" />
      <SkeletonCard height="h-96" />
    </div>
  )
}

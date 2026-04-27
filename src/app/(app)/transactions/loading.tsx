import { SkeletonCard } from '@/components/Skeleton'

export default function TransactionsLoading() {
  return (
    <div className="space-y-3 pb-4">
      <SkeletonCard height="h-10" />
      <SkeletonCard height="h-10" />
      <SkeletonCard height="h-96" />
    </div>
  )
}

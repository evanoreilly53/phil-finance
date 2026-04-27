import { SkeletonCard, SkeletonLine } from '@/components/Skeleton'

export default function SettingsLoading() {
  return (
    <div className="space-y-4">
      <SkeletonLine className="h-7 w-28" />
      <SkeletonCard className="h-10" />
      <SkeletonCard className="h-64" />
    </div>
  )
}

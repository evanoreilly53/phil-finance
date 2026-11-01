'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="bg-gray-900 rounded-2xl border border-red-800 p-6 text-center space-y-3">
      <p className="text-white font-medium">Couldn&apos;t load this page</p>
      <p className="text-sm text-gray-400">
        Some data failed to load, so nothing is shown rather than incomplete totals.
      </p>
      <button
        onClick={() => unstable_retry()}
        className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
      >
        Try again
      </button>
    </div>
  )
}

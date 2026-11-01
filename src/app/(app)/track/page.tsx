import { redirect } from 'next/navigation'

// "Track" has no page of its own; its first tab is Transactions.
export default function TrackPage() {
  redirect('/transactions')
}

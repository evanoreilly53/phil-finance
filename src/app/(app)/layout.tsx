import BottomNav from '@/components/BottomNav'
import TopBar from '@/components/TopBar'
import InstallPrompt from '@/components/InstallPrompt'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Skip link — visible on focus for keyboard/screen reader users */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-indigo-600 focus:text-white focus:px-3 focus:py-1.5 focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="flex-1 overflow-y-auto pb-20 pt-14">
        <div className="max-w-2xl mx-auto px-4 py-4">
          {children}
        </div>
      </main>
      <InstallPrompt />
      <BottomNav />
    </div>
  )
}

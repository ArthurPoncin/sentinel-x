import { RouterProvider } from 'react-router/dom'
import { AuthGate } from '@/features/auth'
import { LiveFeedProvider } from '@/features/live-feed'
import { feedUrl } from '@/shared/config/feed-url'
import { Toaster } from '@/shared/ui/sonner'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { router } from './router'

export function App() {
  return (
    <TooltipProvider>
      <AuthGate>
        <LiveFeedProvider url={feedUrl(window.location)}>
          <RouterProvider router={router} />
        </LiveFeedProvider>
      </AuthGate>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

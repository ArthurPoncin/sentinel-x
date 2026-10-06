import type { ReactNode } from 'react'
import { RouterProvider } from 'react-router/dom'
import { AuthGate, useSessionCheck } from '@/features/auth'
import { LiveFeedProvider } from '@/features/live-feed'
import { feedUrl } from '@/shared/config/feed-url'
import { Toaster } from '@/shared/ui/sonner'
import { router } from './router'

// The feed, under the Operator's session. A socket that goes down does not say why: the Command Post
// out of reach, or its session gone (the API turns the upgrade down). So each time, the session is
// asked for again: gone, the gate brings the login screen back and the feed stops retrying.
function SessionFeed({ children }: { children: ReactNode }) {
  const checkSession = useSessionCheck()
  return (
    <LiveFeedProvider url={feedUrl(window.location)} onDown={checkSession}>
      {children}
    </LiveFeedProvider>
  )
}

export function App() {
  return (
    <>
      <AuthGate>
        <SessionFeed>
          <RouterProvider router={router} />
        </SessionFeed>
      </AuthGate>
      <Toaster position="bottom-right" />
    </>
  )
}

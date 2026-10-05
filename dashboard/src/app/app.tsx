import { RouterProvider } from 'react-router/dom'
import { LiveFeedProvider } from '@/features/live-feed'
import { feedUrl } from '@/shared/config/feed-url'
import { router } from './router'

export function App() {
  return (
    <LiveFeedProvider url={feedUrl(window.location)}>
      <RouterProvider router={router} />
    </LiveFeedProvider>
  )
}

import { type ReactNode, useEffect, useRef } from 'react'
import { announcements } from '@/features/alerts'
import { AnnouncementsProvider, useAnnouncements } from '@/features/announcements'
import { useLiveFeed } from '@/features/live-feed'

// Follows the feed and has announced what changes in it: each Alert raised or escalated, each change of
// Status. Renders nothing.
function Watch() {
  const alerts = useLiveFeed((state) => state.activeAlerts)
  const status = useLiveFeed((state) => state.status)
  const { say } = useAnnouncements()
  const previous = useRef({ alerts, status })

  useEffect(() => {
    const now = { alerts, status }
    say(announcements(previous.current, now))
    previous.current = now
  }, [alerts, status, say])

  return null
}

// What the dashboard announces, over the whole app and on every screen: the Alerts and the Status of the
// feed, said aloud and written for screen readers.
export function Announcements({ children }: { children: ReactNode }) {
  return (
    <AnnouncementsProvider>
      <Watch />
      {children}
    </AnnouncementsProvider>
  )
}

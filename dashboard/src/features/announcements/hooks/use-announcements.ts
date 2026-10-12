import { useContext } from 'react'
import { type Announcements, AnnouncementsContext } from '../stores/announcements-context'

// The built-in voice's switch, and the way to have something announced.
export function useAnnouncements(): Announcements {
  const announcements = useContext(AnnouncementsContext)
  if (!announcements) throw new Error('The announcements must be used inside <AnnouncementsProvider>')
  return announcements
}

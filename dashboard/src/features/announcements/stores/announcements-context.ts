import { createContext } from 'react'

export interface Announcements {
  // Whether the Operator switched the built-in voice on, on this browser.
  enabled: boolean
  setEnabled(enabled: boolean): void
  // Announces these sentences, in their order: written for a screen reader, and said while the voice is on.
  say(phrases: readonly string[]): void
}

export const AnnouncementsContext = createContext<Announcements | null>(null)

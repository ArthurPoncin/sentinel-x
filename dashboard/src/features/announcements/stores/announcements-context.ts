import { createContext } from 'react'

export interface Announcements {
  // Whether the Operator switched the built-in voice on, on this browser.
  enabled: boolean
  setEnabled(enabled: boolean): void
  // Announces these sentences, in their order: written for a screen reader, and said while the voice is on.
  // What the Operator asked for, a report, is announced `whole`: none of it is dropped as a burst's would be.
  say(phrases: readonly string[], whole?: boolean): void
  // Whether the built-in voice is talking: the ear is closed meanwhile.
  talking: boolean
}

export const AnnouncementsContext = createContext<Announcements | null>(null)

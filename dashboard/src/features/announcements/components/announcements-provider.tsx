import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createSpeaker, type Synthesis } from '../api/speaker'
import { AnnouncementsContext } from '../stores/announcements-context'
import { readEnabled, writeEnabled } from '../utils/enabled'
import { type Line, written } from '../utils/queue'

interface Props {
  // The browser's speech synthesis, unless a test says otherwise. Some browsers have none.
  synthesis?: Synthesis
  children: ReactNode
}

// What the dashboard announces, for every feature below, to who does not look at the screen. Each sentence is
// written in a live region, which a screen reader of the Operator's own reads, whatever the switch says; and
// said by the built-in voice while it is switched on. Switched off, it stops in the middle of its sentence.
export function AnnouncementsProvider({ synthesis = window.speechSynthesis, children }: Props) {
  const [speaker] = useState(() => createSpeaker(synthesis))
  const [enabled, setEnabledState] = useState(() => readEnabled(window.localStorage))
  const [lines, setLines] = useState<readonly Line[]>([])

  const setEnabled = useCallback(
    (next: boolean) => {
      writeEnabled(window.localStorage, next)
      setEnabledState(next)
      if (!next) speaker.hush()
    },
    [speaker],
  )

  const say = useCallback(
    (phrases: readonly string[]) => {
      if (phrases.length === 0) return
      setLines((known) => written(known, phrases))
      if (enabled) speaker.say(phrases)
    },
    [enabled, speaker],
  )

  // The page left, or the session: no sentence goes on without it.
  useEffect(() => () => speaker.hush(), [speaker])

  const announcements = useMemo(() => ({ enabled, setEnabled, say }), [enabled, setEnabled, say])
  return (
    <AnnouncementsContext value={announcements}>
      {children}
      <div className="sr-only" role="log" aria-live="polite" aria-label="Annonces" data-announcements>
        {lines.map(({ id, text }) => (
          <p key={id}>{text}</p>
        ))}
      </div>
    </AnnouncementsContext>
  )
}

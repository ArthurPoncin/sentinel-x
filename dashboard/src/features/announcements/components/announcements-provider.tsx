import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSpeaker, type Synthesis } from '../api/speaker'
import { AnnouncementsContext } from '../stores/announcements-context'
import { readEnabled, writeEnabled } from '../utils/enabled'
import { type Line, WRITTEN_LIMIT, written } from '../utils/queue'

interface Props {
  // The browser's speech synthesis, unless a test says otherwise. Some browsers have none.
  synthesis?: Synthesis
  children: ReactNode
}

// What the dashboard announces, for every feature below, to who does not look at the screen. Each sentence is
// written in a live region, which a screen reader of the Operator's own reads, whatever the switch says; and
// said by the built-in voice while it is switched on. Switched off, it stops in the middle of its sentence.
export function AnnouncementsProvider({ synthesis = window.speechSynthesis, children }: Props) {
  const [talking, setTalking] = useState(false)
  const [speaker] = useState(() => createSpeaker(synthesis, undefined, setTalking))
  const [enabled, setEnabledState] = useState(() => readEnabled(window.localStorage))
  // The switch as it is now, for a sentence announced in the instant it is turned: the one that answers
  // « silence » is not said, the one that answers its lift is.
  const on = useRef(enabled)
  const [lines, setLines] = useState<readonly Line[]>([])

  const setEnabled = useCallback(
    (next: boolean) => {
      on.current = next
      writeEnabled(window.localStorage, next)
      setEnabledState(next)
      if (!next) speaker.hush()
    },
    [speaker],
  )

  const say = useCallback(
    (phrases: readonly string[], whole = false) => {
      if (phrases.length === 0) return
      setLines((known) => written(known, phrases, whole ? Math.max(WRITTEN_LIMIT, phrases.length) : WRITTEN_LIMIT))
      if (on.current) speaker.say(phrases, whole)
    },
    [speaker],
  )

  // The page left, or the session: no sentence goes on without it.
  useEffect(() => () => speaker.hush(), [speaker])

  const announcements = useMemo(() => ({ enabled, setEnabled, say, talking }), [enabled, setEnabled, say, talking])
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

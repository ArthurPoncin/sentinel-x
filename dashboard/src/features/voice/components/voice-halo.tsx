import { useCallback, useRef } from 'react'
import { useVoiceLevel, useVoiceState, useVoiceSwitch } from '../hooks/use-voice-control'
import { lastLine, statusLine, TALKING_LINE } from '../utils/lines'

interface Props {
  // Whether the built-in voice is talking: the halo then beats with it, not with the microphone.
  talking?: boolean
}

// On the Twin's stage while the voice control is on, in place of the top bar's dot: a halo that swells with the
// microphone while the ear listens, lights up at the wake word for as long as a command is taken, and beats while
// the dashboard talks. The last sentence heard, with what was made of it, stays written next to it. The level
// moves one CSS variable, some times a second: nothing is rendered again, and the scene keeps its frames.
// Nothing without the voice control.
export function VoiceHalo({ talking = false }: Props) {
  const { enabled } = useVoiceSwitch()
  const status = useVoiceState((state) => state.status)
  const last = useVoiceState((state) => state.last)
  const orb = useRef<HTMLSpanElement>(null)
  useVoiceLevel(useCallback((level: number) => orb.current?.style.setProperty('--level', level.toFixed(2)), []))
  if (!enabled || status === 'off') return null

  return (
    <div
      className="voice-halo"
      role="status"
      data-status={status}
      data-talking={talking || undefined}
      data-outcome={last?.outcome.kind}
    >
      <span className="voice-halo-orb" aria-hidden="true" ref={orb}>
        <span className="voice-halo-glow" />
        <span className="voice-halo-core" />
      </span>
      <span className="voice-halo-lines">
        <span>{talking ? TALKING_LINE : statusLine(status)}</span>
        {last && <span className="voice-halo-last">{lastLine(last)}</span>}
      </span>
    </div>
  )
}

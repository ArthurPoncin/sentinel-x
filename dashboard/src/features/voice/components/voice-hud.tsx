import { useVoiceState, useVoiceSwitch } from '../hooks/use-voice-control'
import { lastLine, statusLine } from '../utils/lines'

// In the top bar while the voice control is on: a dot and a line that say where the ear is (the microphone
// asked for, the model loading, listening, awake), and the last sentence heard with what was made of it.
// Nothing without it.
export function VoiceHud() {
  const { enabled } = useVoiceSwitch()
  const status = useVoiceState((state) => state.status)
  const last = useVoiceState((state) => state.last)
  if (!enabled || status === 'off') return null

  return (
    <div className="voice-hud" role="status" data-status={status} data-outcome={last?.outcome.kind}>
      <span className="voice-hud-dot" aria-hidden="true" />
      <span>{statusLine(status)}</span>
      {last && <span className="voice-hud-last">{lastLine(last)}</span>}
    </div>
  )
}

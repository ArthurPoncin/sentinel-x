import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useLiveFeed } from '@/features/live-feed'
import { type Command, failureLine, VoiceControlProvider } from '@/features/voice'
import { answer, driveAlarm, presetOfVoice } from './alarm'

interface Props {
  // Where the app is, as the command is said.
  pathname(): string
  children: ReactNode
}

// What the Operator's voice does, over the whole app: after the wake word, a command drives the Sentinel's
// Alarm by the path a gesture and a press on the actuator panel take, with the same answers. Not in the
// tutorial, where a command is only tried. An ear that cannot listen says why, and the switch is off again.
export function VoiceControl({ pathname, children }: Props) {
  const sentinel = useLiveFeed((state) => state.latestTelemetry?.sentinel ?? null)

  const act = async (command: Command) => {
    const preset = presetOfVoice(command, pathname())
    if (preset) answer(await driveAlarm(sentinel, preset, 'voice'))
  }

  return (
    <VoiceControlProvider
      onCommand={(command) => void act(command)}
      onFailure={(failure) => toast.error('Commande vocale désactivée', { description: failureLine(failure) })}
    >
      {children}
    </VoiceControlProvider>
  )
}

import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useLiveFeed } from '@/features/live-feed'
import { fetchLastClosedIncident } from '@/features/replay'
import { type Command, failureLine, VoiceControlProvider } from '@/features/voice'
import { answer, driveAlarm, presetOfVoice } from './alarm'
import { NAV, TWIN } from './app-sidebar'
import { replayAsked } from './replay-asked'

// Where a voice command leads from `pathname`: to the screen it names. Nowhere when it names none, or the one
// the app is on already, a slash at its end or not. Out of the tutorial too: a screen's name is not one of the
// gestures tried there, and a swipe would never lead out of it.
export function pageOfVoice(command: Command, pathname: string): string | null {
  const to = NAV.find(({ voice }) => voice === command)?.to
  return to === undefined || to === (pathname.replace(/\/+$/, '') || '/') ? null : to
}

interface Props {
  // Goes to a screen, with what the way to it carries.
  navigate(to: string, state?: unknown): void
  // Where the app is, as the command is said.
  pathname(): string
  children: ReactNode
}

// What the Operator's voice does, over the whole app: after the wake word, a command drives the Sentinel's
// Alarm by the path a gesture and a press on the actuator panel take, with the same answers, not in the
// tutorial, where it is only tried; the name of a screen leads to it; and the last Incident that closed is
// replayed on the Twin, from the list the Command Post already gives. An ear that cannot listen says why, and
// the switch is off again.
export function VoiceControl({ navigate, pathname, children }: Props) {
  const sentinel = useLiveFeed((state) => state.latestTelemetry?.sentinel ?? null)

  const replayLast = async () => {
    let incident: Awaited<ReturnType<typeof fetchLastClosedIncident>>
    try {
      incident = await fetchLastClosedIncident()
    } catch {
      return toast.error('Incidents injoignables', {
        description: "Commande vocale · le Command Post n'a pas donné ses incidents.",
      })
    }
    // Said, and nothing else: the screen stays where it is.
    if (!incident) {
      return toast.info('Aucun incident à rejouer', { description: "Commande vocale · aucun incident clos n'est enregistré." })
    }
    navigate(TWIN, replayAsked(incident))
    toast.success(`Incident #${incident.incident_id}`, { description: 'Commande vocale · rejoué sur le Digital Twin' })
  }

  const act = async (command: Command) => {
    if (command === 'replay-last') return void (await replayLast())
    const page = pageOfVoice(command, pathname())
    if (page) return navigate(page)
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

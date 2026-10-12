import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { report } from '@/features/alerts'
import { useAnnouncements } from '@/features/announcements'
import { useLiveFeed } from '@/features/live-feed'
import { fetchLastClosedIncident } from '@/features/replay'
import { acknowledge, type Command, failureLine, type Reply, VoiceControlProvider } from '@/features/voice'
import { type Answer, answer, driveAlarm, presetOfVoice } from './alarm'
import { inTutorial, NAV, TWIN } from './app-sidebar'
import { replayAsked } from './replay-asked'
import { windowsAsked, windowsOfVoice } from './windows-asked'

// Where a voice command leads from `pathname`: to the screen it names. Nowhere when it names none, or the one
// the app is on already, a slash at its end or not. Out of the tutorial too: a screen's name is not one of the
// gestures tried there, and a swipe would never lead out of it.
export function pageOfVoice(command: Command, pathname: string): string | null {
  const to = NAV.find(({ voice }) => voice === command)?.to
  return to === undefined || to === (pathname.replace(/\/+$/, '') || '/') ? null : to
}

// The sentences that answer a command for the Alarm, once the Command Post has: that it is done, or what
// happened to it, in the words of the toast. Never that the siren sounds before its relay failed.
export function alarmSaid(command: 'siren' | 'siren-off', fired: Answer, draw?: () => number): string[] {
  if (fired.success) return [acknowledge(command, draw)]
  return [acknowledge('alarm-failed', draw), `${fired.title}. ${fired.description}`]
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
// replayed on the Twin, from the list the Command Post already gives. A window of the Twin is shown by its name,
// from any screen, and closed by it, or all of them at once: the Twin is told by the way to it. « Rapport » has
// the Status and the active Alerts said; « silence » hushes the announcements, until they are asked for again.
// Each command taken is answered in a short sentence, said and written, and so is one refused or not
// understood. The ear is closed while the dashboard talks. An ear that cannot listen says why, and the switch
// is off again.
export function VoiceControl({ navigate, pathname, children }: Props) {
  const sentinel = useLiveFeed((state) => state.latestTelemetry?.sentinel ?? null)
  const alerts = useLiveFeed((state) => state.activeAlerts)
  const status = useLiveFeed((state) => state.status)
  const { say, setEnabled: setSpoken, talking } = useAnnouncements()

  const replayLast = async (): Promise<Reply> => {
    let incident: Awaited<ReturnType<typeof fetchLastClosedIncident>>
    try {
      incident = await fetchLastClosedIncident()
    } catch {
      toast.error('Incidents injoignables', {
        description: "Commande vocale · le Command Post n'a pas donné ses incidents.",
      })
      return 'incidents-unreachable'
    }
    // Said, and nothing else: the screen stays where it is.
    if (!incident) {
      toast.info('Aucun incident à rejouer', { description: "Commande vocale · aucun incident clos n'est enregistré." })
      return 'nothing-to-replay'
    }
    navigate(TWIN, replayAsked(incident))
    toast.success(`Incident #${incident.incident_id}`, { description: 'Commande vocale · rejoué sur le Digital Twin' })
    return 'replay-last'
  }

  // Carries the command out, and gives the sentences that answer it: once it is known how it went.
  const carryOut = async (command: Command): Promise<readonly string[]> => {
    switch (command) {
      case 'report':
        return [acknowledge(command), ...report({ alerts, status })]
      case 'silence':
        // The switch of the menu, turned by the voice: the sentence it was on stops, and this answer stays written.
        setSpoken(false)
        return [acknowledge(command)]
      case 'speak':
        setSpoken(true)
        return [acknowledge(command)]
      case 'replay-last':
        return [acknowledge(await replayLast())]
      case 'siren':
      case 'siren-off': {
        const preset = presetOfVoice(command, pathname())
        if (!preset) return [acknowledge('only-tried')]
        const fired = await driveAlarm(sentinel, preset, 'voice')
        answer(fired)
        return alarmSaid(command, fired)
      }
      case 'operator':
      case 'twin':
      case 'tutorial': {
        const page = pageOfVoice(command, pathname())
        if (!page) return [acknowledge('already-there')]
        navigate(page)
        return [acknowledge(command)]
      }
      default: {
        if (inTutorial(pathname())) return [acknowledge('only-tried')]
        const windows = windowsOfVoice(command, pathname())
        // Closed from another screen than the Twin: there is none open there.
        if (!windows) return [acknowledge('no-window')]
        navigate(TWIN, windowsAsked(windows))
        return [acknowledge(command)]
      }
    }
  }

  // A report is what was asked for: said whole, however many Alerts are active.
  const act = async (command: Command) => say(await carryOut(command), command === 'report')

  return (
    <VoiceControlProvider
      onCommand={(command) => void act(command)}
      onMissed={(missed) => say([acknowledge(missed)])}
      talking={talking}
      onFailure={(failure) => toast.error('Commande vocale désactivée', { description: failureLine(failure) })}
    >
      {children}
    </VoiceControlProvider>
  )
}

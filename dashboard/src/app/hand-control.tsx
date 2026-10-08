import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { firePreset, type PresetId } from '@/features/actuators'
import { type Action, HandControlProvider } from '@/features/gestures'
import { useLiveFeed } from '@/features/live-feed'
import { screens, TUTORIAL } from './app-sidebar'

// The Alarm's command a thumb stands for: raised, all is well and the siren stops; turned down, it sounds.
const PRESET_OF: Partial<Record<Action, PresetId>> = { 'all-clear': 'siren-off', alarm: 'siren' }

// The screen a swipe goes to from `pathname`: the next one in the menu as the hand sweeps to the left, a page
// turned; the one before as it sweeps to the right. Past the last comes the first: with two screens, any swipe
// goes to the other. The hand control's tutorial is not one of them: a swipe does nothing there, and would
// never lead out of it.
export function pageAfter(pathname: string, action: 'page-left' | 'page-right'): string {
  const surfaces = screens(false)
  const at = surfaces.findIndex(({ to }) => to === pathname)
  const step = action === 'page-left' ? 1 : -1
  return surfaces[(Math.max(at, 0) + step + surfaces.length) % surfaces.length]?.to ?? '/'
}

// Whether the screen at `pathname` is the tutorial, a slash at its end or not: the router shows it for both.
export function inTutorial(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === TUTORIAL
}

interface Props {
  navigate(to: string): void
  // Where the app is, as the gesture is made.
  pathname(): string
  children: ReactNode
}

// What the Operator's gestures do, over the whole app: a thumb held up or down drives the Sentinel's Alarm, as
// a press on the actuator panel does and with the same answers; a hand swept on its edge changes screen. Not
// in the tutorial, where they are only tried.
export function HandControl({ navigate, pathname, children }: Props) {
  const sentinel = useLiveFeed((state) => state.latestTelemetry?.sentinel ?? null)

  const act = async (action: Action) => {
    // In the tutorial a gesture is tried, not meant: the page shows it was made, and nothing is done about it.
    if (inTutorial(pathname())) return
    if (action === 'page-left' || action === 'page-right') return navigate(pageAfter(pathname(), action))
    const preset = PRESET_OF[action]
    if (!preset) return
    const fired = await firePreset(sentinel, preset)
    if (!fired.success) return toast.error(fired.title, { description: fired.description })
    toast.success(fired.label, { description: `Geste reconnu · commande transmise à ${fired.command.sentinel}` })
  }

  return <HandControlProvider onAction={(action) => void act(action)}>{children}</HandControlProvider>
}

import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { firePreset, type PresetId } from '@/features/actuators'
import { type Action, HandControlProvider } from '@/features/gestures'
import { useLiveFeed } from '@/features/live-feed'
import { NAV } from './app-sidebar'

// The Alarm's command a thumb stands for: raised, all is well and the siren stops; turned down, it sounds.
const PRESET_OF: Partial<Record<Action, PresetId>> = { 'all-clear': 'siren-off', alarm: 'siren' }

// The screen a swipe goes to from `pathname`: the next one in the menu as the hand sweeps to the left, a page
// turned; the one before as it sweeps to the right. Past the last comes the first: with two screens, any swipe
// goes to the other.
export function pageAfter(pathname: string, action: 'page-left' | 'page-right'): string {
  const at = NAV.findIndex(({ to }) => to === pathname)
  const step = action === 'page-left' ? 1 : -1
  const next = NAV[(Math.max(at, 0) + step + NAV.length) % NAV.length] ?? NAV[0]
  return next.to
}

interface Props {
  navigate(to: string): void
  // Where the app is, as the gesture is made.
  pathname(): string
  children: ReactNode
}

// What the Operator's gestures do, over the whole app: a thumb held up or down drives the Sentinel's Alarm, as
// a press on the actuator panel does and with the same answers; a hand swept on its edge changes screen.
export function HandControl({ navigate, pathname, children }: Props) {
  const sentinel = useLiveFeed((state) => state.latestTelemetry?.sentinel ?? null)

  const act = async (action: Action) => {
    if (action === 'page-left' || action === 'page-right') return navigate(pageAfter(pathname(), action))
    const preset = PRESET_OF[action]
    if (!preset) return
    const fired = await firePreset(sentinel, preset)
    if (!fired.success) return toast.error(fired.title, { description: fired.description })
    toast.success(fired.label, { description: `Geste reconnu · commande transmise à ${fired.command.sentinel}` })
  }

  return <HandControlProvider onAction={(action) => void act(action)}>{children}</HandControlProvider>
}

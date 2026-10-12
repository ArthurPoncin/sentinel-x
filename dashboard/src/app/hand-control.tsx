import type { ReactNode } from 'react'
import { type Action, HandControlProvider } from '@/features/gestures'
import { useLiveFeed } from '@/features/live-feed'
import { answer, driveAlarm, presetOfGesture } from './alarm'
import { inTutorial, screens } from './app-sidebar'

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
    const preset = presetOfGesture(action, pathname())
    if (preset) answer(await driveAlarm(sentinel, preset, 'hand'))
  }

  return <HandControlProvider onAction={(action) => void act(action)}>{children}</HandControlProvider>
}

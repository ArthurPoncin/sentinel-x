import type { AlertKind } from '@/shared/contract'

// The glass windows that float beside the Outpost on the Twin's screen. This is all there is to know of them:
// which are open, who opened each, since when, and in which slot it sits. It takes events and gives the windows
// after them: the mouse and the keyboard send them today, the Alerts open and close theirs by them, and whatever
// opens or closes a window later sends the same ones: a hand that aims at one and fires closes it, the voice
// opens and closes them by their names. Pure: the instant comes with the event.

// The windows there are, each with its French name: what the bar and the window's title read.
export const WINDOWS = {
  camera: { name: 'Caméra' },
  gas: { name: 'Gaz' },
  temperature: { name: 'Température' },
  alerts: { name: 'Alertes' },
  incidents: { name: 'Incidents' },
  security: { name: 'Sécurité' },
} as const

export type WindowId = keyof typeof WINDOWS
export const WINDOW_IDS = Object.keys(WINDOWS) as WindowId[]

// Who asked for a window: the Operator, or an Alert raised.
export type Opener = 'operator' | 'alert'

// The window an Alert concerns, which opens by itself when it is raised. The other kinds open none.
export const WINDOW_OF: Partial<Record<AlertKind, WindowId>> = {
  intrusion: 'camera',
  gas: 'gas',
  thermal: 'temperature',
  predictive: 'temperature',
  cyber: 'security',
}

// How long a window an Alert opened stays once the Alert has cleared, in milliseconds.
export const CLOSE_AFTER_MS = 5_000

// Where a window sits: fixed places on either side of the Outpost, never over it, two to a side. In the order
// they are taken: a side in turn, the upper ones first.
export const SLOTS = ['left-top', 'right-top', 'left-bottom', 'right-bottom'] as const
export type Slot = (typeof SLOTS)[number]

// Where each slot is on the screen: which side of the Outpost, and which of that side's two places.
export const SIDES = ['left', 'right'] as const
export const SLOT_PLACE: Record<Slot, { side: (typeof SIDES)[number]; row: 'top' | 'bottom' }> = {
  'left-top': { side: 'left', row: 'top' },
  'right-top': { side: 'right', row: 'top' },
  'left-bottom': { side: 'left', row: 'bottom' },
  'right-bottom': { side: 'right', row: 'bottom' },
}

// How many windows are open at most: one a slot, fewer than there are windows.
export const MAX_WINDOWS = SLOTS.length

export interface OpenWindow {
  id: WindowId
  by: Opener
  // When it was opened, in milliseconds.
  since: number
  slot: Slot
  // When it closes by itself, in milliseconds: only for one an Alert opened, once its Alert has cleared.
  until?: number
}

// The open windows, in the order they were opened.
export type Windows = readonly OpenWindow[]

export const NO_WINDOWS: Windows = []

// What is held between two events: the open windows, and the windows an Alert concerned at the last look. An
// Alert opens its window as it is raised, not for as long as it lasts: one the Operator closed stays closed while
// the Alert goes on, raised again or not.
// `shot` are the windows a shot closed, until each opens again: they go out as no other does.
export interface WindowsState {
  open: Windows
  alerted: readonly WindowId[]
  shot: readonly WindowId[]
}

export const NO_WINDOWS_STATE: WindowsState = { open: NO_WINDOWS, alerted: [], shot: [] }

export type WindowEvent =
  | { type: 'open'; id: WindowId; by: Opener; at: number }
  // `by` a shot when a hand that aimed at it fired: it is closed as by any other, and said to have been shot.
  | { type: 'close'; id: WindowId; by?: 'shot' }
  // Every window at once, whoever opened it.
  | { type: 'close-all' }
  // The Alerts active at an instant, by their kinds: sent when they change, and when time has passed.
  | { type: 'alerts'; kinds: readonly AlertKind[]; at: number }

export function isOpen(windows: Windows, id: WindowId): boolean {
  return windows.some((open) => open.id === id)
}

// The windows with one more. It takes the first free slot; past the limit there is none, and the window open for
// the longest gives way: the new one takes its slot.
function opened(windows: Windows, id: WindowId, by: Opener, at: number): Windows {
  const [oldest, ...newer] = windows
  const kept = oldest && windows.length >= MAX_WINDOWS ? newer : windows
  const slot = SLOTS.find((free) => kept.every((open) => open.slot !== free)) ?? SLOTS[0]
  return [...kept, { id, by, since: at, slot }]
}

// The windows a shot closed that are still closed: one that is open again was not shot, however it closes next.
function stillShot(shot: readonly WindowId[], open: Windows): readonly WindowId[] {
  return shot.some((id) => isOpen(open, id)) ? shot.filter((id) => !isOpen(open, id)) : shot
}

// An open window without the instant it was to close at.
function staying({ until: _, ...window }: OpenWindow): OpenWindow {
  return window
}

// The windows at an instant, given the ones the active Alerts concern. One newly concerned opens, by the Alert;
// one already open stays whose it is. One an Alert opened closes CLOSE_AFTER_MS after no Alert concerns it any
// more, and stays if one does again meanwhile. The Operator's are left alone.
function watched(state: WindowsState, alerted: readonly WindowId[], at: number): WindowsState {
  const raised = alerted.filter((id) => !state.alerted.includes(id) && !isOpen(state.open, id))
  const open = raised
    .reduce((windows, id) => opened(windows, id, 'alert', at), state.open)
    .map((window) => {
      if (window.by !== 'alert') return window
      if (alerted.includes(window.id)) return window.until === undefined ? window : staying(window)
      // Never later than the delay from now: time goes back when a replay starts or is wound back.
      const until = Math.min(window.until ?? Number.POSITIVE_INFINITY, at + CLOSE_AFTER_MS)
      return until === window.until ? window : { ...window, until }
    })
    .filter((window) => window.until === undefined || window.until > at)
  const same = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, i) => item === b[i])
  if (same(open, state.open) && same(alerted, state.alerted)) return state
  return { open: same(open, state.open) ? state.open : open, alerted, shot: stillShot(state.shot, open) }
}

// The windows after an event. A window already open stays as it is, where it is: opening it again makes no
// second one. One an Alert opened becomes the Operator's when the Operator asks for it, and then closes only at
// the Operator's word. What changes nothing gives back the same state.
export function windowsAfter(state: WindowsState, event: WindowEvent): WindowsState {
  const { open } = state
  switch (event.type) {
    case 'close': {
      if (!isOpen(open, event.id)) return state
      const shot = event.by === 'shot' ? [...state.shot, event.id] : state.shot
      return { ...state, open: open.filter((window) => window.id !== event.id), shot }
    }
    case 'close-all':
      // The Alerts going on are still known: none opens its window again for having lasted.
      return open.length === 0 ? state : { ...state, open: NO_WINDOWS }
    case 'open': {
      const there = open.find((window) => window.id === event.id)
      if (!there) {
        const more = opened(open, event.id, event.by, event.at)
        return { ...state, open: more, shot: stillShot(state.shot, more) }
      }
      if (there.by === event.by || event.by === 'alert') return state
      return { ...state, open: open.map((window) => (window === there ? { ...staying(window), by: event.by } : window)) }
    }
    case 'alerts': {
      const alerted = [...new Set(event.kinds.flatMap((kind) => WINDOW_OF[kind] ?? []))]
      return watched(state, alerted, event.at)
    }
  }
}

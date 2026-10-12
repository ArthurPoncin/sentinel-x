// The glass windows that float beside the Outpost on the Twin's screen. This is all there is to know of them:
// which are open, who opened each, since when, and in which slot it sits. It takes events and gives the windows
// after them: the mouse and the keyboard send them today, and whatever opens or closes a window later sends the
// same ones. Pure: the instant comes with the event.

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

// Who asked for a window.
export type Opener = 'operator'

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
}

// The open windows, in the order they were opened.
export type Windows = readonly OpenWindow[]

export const NO_WINDOWS: Windows = []

export type WindowEvent = { type: 'open'; id: WindowId; by: Opener; at: number } | { type: 'close'; id: WindowId }

export function isOpen(windows: Windows, id: WindowId): boolean {
  return windows.some((open) => open.id === id)
}

// The windows after an event. A window already open stays as it is, where it is: opening it again makes no
// second one. It takes the first free slot; past the limit there is none, and the window open for the longest
// gives way: the new one takes its slot. What changes nothing gives back the same windows.
export function windowsAfter(windows: Windows, event: WindowEvent): Windows {
  if (event.type === 'close') return isOpen(windows, event.id) ? windows.filter((open) => open.id !== event.id) : windows
  if (isOpen(windows, event.id)) return windows
  const [oldest, ...newer] = windows
  const kept = oldest && windows.length >= MAX_WINDOWS ? newer : windows
  const slot = SLOTS.find((free) => kept.every((open) => open.slot !== free)) ?? SLOTS[0]
  return [...kept, { id: event.id, by: event.by, since: event.at, slot }]
}

// The glass windows that float beside the Outpost on the Twin's screen. This is all there is to know of them:
// which are open, who opened each, since when, and in which slot it sits. It takes events and gives the windows
// after them: the mouse and the keyboard send them today, and whatever opens or closes a window later sends the
// same ones. Pure: the instant comes with the event.

// The windows there are, each with its French name: what the bar and the window's title read.
export const WINDOWS = {
  camera: { name: 'Caméra' },
} as const

export type WindowId = keyof typeof WINDOWS
export const WINDOW_IDS = Object.keys(WINDOWS) as WindowId[]

// Who asked for a window.
export type Opener = 'operator'

// Where a window sits: fixed places on either side of the Outpost, never over it. In the order they are taken.
export const SLOTS = ['left', 'right'] as const
export type Slot = (typeof SLOTS)[number]

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
// second one. It takes the first free slot, and none is opened while there is no slot left. What changes
// nothing gives back the same windows.
export function windowsAfter(windows: Windows, event: WindowEvent): Windows {
  if (event.type === 'close') return isOpen(windows, event.id) ? windows.filter((open) => open.id !== event.id) : windows
  if (isOpen(windows, event.id)) return windows
  const slot = SLOTS.find((free) => windows.every((open) => open.slot !== free))
  return slot ? [...windows, { id: event.id, by: event.by, since: event.at, slot }] : windows
}

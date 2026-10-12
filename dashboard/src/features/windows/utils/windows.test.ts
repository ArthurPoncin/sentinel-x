import { describe, expect, it } from 'vitest'
import {
  isOpen,
  MAX_WINDOWS,
  NO_WINDOWS,
  SLOT_PLACE,
  SLOTS,
  WINDOW_IDS,
  WINDOWS,
  type WindowEvent,
  type WindowId,
  type Windows,
  windowsAfter,
} from './windows'

const open = (at = 1000, id: WindowId = 'camera'): WindowEvent => ({ type: 'open', id, by: 'operator', at })
const close: WindowEvent = { type: 'close', id: 'camera' }
const after = (...events: WindowEvent[]): Windows => events.reduce(windowsAfter, NO_WINDOWS)
// Each window of the catalogue opened in turn, a second apart, from the instant 1000.
const all = (): Windows => after(...WINDOW_IDS.map((id, rank) => open(1000 * (rank + 1), id)))

describe('the windows there are', () => {
  it('have each a French name', () => {
    expect(WINDOW_IDS).toEqual(['camera', 'gas', 'temperature', 'alerts', 'incidents'])
    expect(WINDOW_IDS.map((id) => WINDOWS[id].name)).toEqual(['Caméra', 'Gaz', 'Température', 'Alertes', 'Incidents'])
  })

  it('have slots on either side of the Outpost, taken a side in turn', () => {
    expect(SLOTS).toEqual(['left-top', 'right-top', 'left-bottom', 'right-bottom'])
  })

  it('have each slot in a place of its own, two to a side', () => {
    const places = SLOTS.map((slot) => `${SLOT_PLACE[slot].side} ${SLOT_PLACE[slot].row}`)
    expect(places).toEqual(['left top', 'right top', 'left bottom', 'right bottom'])
  })

  it('are more than can be open at once', () => {
    expect(MAX_WINDOWS).toBe(SLOTS.length)
    expect(WINDOW_IDS.length).toBeGreaterThan(MAX_WINDOWS)
  })
})

describe('windowsAfter', () => {
  it('opens a window: which, by whom, since when, in the first slot', () => {
    expect(after(open(1000))).toEqual([{ id: 'camera', by: 'operator', since: 1000, slot: 'left-top' }])
    expect(isOpen(after(open()), 'camera')).toBe(true)
  })

  it('closes it', () => {
    expect(after(open(), close)).toEqual([])
    expect(isOpen(after(open(), close), 'camera')).toBe(false)
  })

  it('does not open a second one of a window already open, nor move the first', () => {
    const once = after(open(1000))
    expect(windowsAfter(once, open(5000))).toBe(once)
  })

  it('changes nothing when a closed window is closed', () => {
    expect(windowsAfter(NO_WINDOWS, close)).toBe(NO_WINDOWS)
  })

  it('opens it again after it was closed, since the new instant', () => {
    expect(after(open(1000), close, open(9000))).toEqual([{ id: 'camera', by: 'operator', since: 9000, slot: 'left-top' }])
  })

  it('leaves the windows it was given as they were', () => {
    const before = after(open())
    windowsAfter(before, close)
    expect(before).toHaveLength(1)
  })

  it('gives each open window a slot of its own', () => {
    const windows = after(open(1000, 'camera'), open(2000, 'gas'), open(3000, 'temperature'), open(4000, 'alerts'))
    expect(windows.map(({ slot }) => slot)).toEqual(SLOTS)
  })

  it('gives a new window the slot a closed one left', () => {
    const windows = after(open(1000, 'camera'), open(2000, 'gas'), open(3000, 'temperature'), close, open(4000, 'alerts'))
    expect(windows.find(({ id }) => id === 'alerts')?.slot).toBe('left-top')
    expect(new Set(windows.map(({ slot }) => slot)).size).toBe(windows.length)
  })

  it('makes the window open for the longest give way past the limit, and gives its slot to the new one', () => {
    const windows = all()
    expect(windows).toHaveLength(MAX_WINDOWS)
    expect(isOpen(windows, 'camera')).toBe(false)
    expect(windows.at(-1)).toEqual({ id: 'incidents', by: 'operator', since: 5000, slot: 'left-top' })
    expect(new Set(windows.map(({ slot }) => slot)).size).toBe(MAX_WINDOWS)
  })

  it('counts a window opened again as the newest', () => {
    // The camera is closed and opened again last: the gas window is then the one open for the longest.
    const windows = after(
      open(1000, 'camera'),
      open(2000, 'gas'),
      open(3000, 'temperature'),
      open(4000, 'alerts'),
      close,
      open(5000, 'camera'),
      open(6000, 'incidents'),
    )
    expect(windows.map(({ id }) => id)).toEqual(['temperature', 'alerts', 'camera', 'incidents'])
  })
})

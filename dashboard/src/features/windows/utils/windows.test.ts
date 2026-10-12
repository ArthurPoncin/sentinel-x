import { describe, expect, it } from 'vitest'
import type { AlertKind } from '@/shared/contract'
import {
  CLOSE_AFTER_MS,
  isOpen,
  MAX_WINDOWS,
  NO_WINDOWS_STATE,
  SLOT_PLACE,
  SLOTS,
  WINDOW_IDS,
  WINDOW_OF,
  WINDOWS,
  type WindowEvent,
  type WindowId,
  type Windows,
  type WindowsState,
  windowsAfter,
} from './windows'

const open = (at = 1000, id: WindowId = 'camera'): WindowEvent => ({ type: 'open', id, by: 'operator', at })
const close: WindowEvent = { type: 'close', id: 'camera' }
const stateAfter = (...events: WindowEvent[]): WindowsState => events.reduce(windowsAfter, NO_WINDOWS_STATE)
const after = (...events: WindowEvent[]): Windows => stateAfter(...events).open
// The Alerts active at an instant, by their kinds.
const alerts = (at: number, ...kinds: AlertKind[]): WindowEvent => ({ type: 'alerts', kinds, at })
// Each window of the catalogue opened in turn, a second apart, from the instant 1000.
const all = (): Windows => after(...WINDOW_IDS.map((id, rank) => open(1000 * (rank + 1), id)))

describe('the windows there are', () => {
  it('have each a French name', () => {
    expect(WINDOW_IDS).toEqual(['camera', 'gas', 'temperature', 'alerts', 'incidents', 'security'])
    expect(WINDOW_IDS.map((id) => WINDOWS[id].name)).toEqual([
      'Caméra',
      'Gaz',
      'Température',
      'Alertes',
      'Incidents',
      'Sécurité',
    ])
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
    const once = stateAfter(open(1000))
    expect(windowsAfter(once, open(5000))).toBe(once)
  })

  it('changes nothing when a closed window is closed', () => {
    expect(windowsAfter(NO_WINDOWS_STATE, close)).toBe(NO_WINDOWS_STATE)
  })

  it('opens it again after it was closed, since the new instant', () => {
    expect(after(open(1000), close, open(9000))).toEqual([{ id: 'camera', by: 'operator', since: 9000, slot: 'left-top' }])
  })

  it('leaves the windows it was given as they were', () => {
    const before = stateAfter(open())
    windowsAfter(before, close)
    expect(before.open).toHaveLength(1)
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
    const windows = after(...WINDOW_IDS.slice(0, MAX_WINDOWS + 1).map((id, rank) => open(1000 * (rank + 1), id)))
    expect(windows).toHaveLength(MAX_WINDOWS)
    expect(isOpen(windows, 'camera')).toBe(false)
    expect(windows.at(-1)).toEqual({ id: 'incidents', by: 'operator', since: 5000, slot: 'left-top' })
    expect(new Set(windows.map(({ slot }) => slot)).size).toBe(MAX_WINDOWS)
  })

  it('keeps the latest opened when every window of the catalogue is asked for in turn', () => {
    const windows = all()
    expect(windows.map(({ id }) => id)).toEqual(WINDOW_IDS.slice(-MAX_WINDOWS))
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

describe('the window an Alert concerns', () => {
  const ids = (windows: Windows) => windows.map(({ id }) => id)
  const cleared = 20_000
  const due = cleared + CLOSE_AFTER_MS

  it('is the camera for an intrusion, the gas for a leak, the temperature for heat or a predicted drift, the security one for an attack', () => {
    expect(WINDOW_OF).toEqual({
      intrusion: 'camera',
      gas: 'gas',
      thermal: 'temperature',
      predictive: 'temperature',
      cyber: 'security',
    })
  })

  it('opens by itself when the Alert is raised, by the Alert, since that instant', () => {
    expect(after(alerts(1000, 'intrusion'))).toEqual([{ id: 'camera', by: 'alert', since: 1000, slot: 'left-top' }])
    expect(ids(after(alerts(1000, 'gas')))).toEqual(['gas'])
    expect(ids(after(alerts(1000, 'thermal')))).toEqual(['temperature'])
    expect(ids(after(alerts(1000, 'predictive')))).toEqual(['temperature'])
    expect(ids(after(alerts(1000, 'cyber')))).toEqual(['security'])
  })

  it('is one window for two Alerts that concern the same', () => {
    expect(ids(after(alerts(1000, 'thermal', 'predictive')))).toEqual(['temperature'])
  })

  it('is none for a presence or a noise', () => {
    expect(after(alerts(1000, 'presence', 'noise'))).toEqual([])
  })

  it('closes the security window after the delay that follows the end of the attack, not while it is raised again', () => {
    const attacked = after(alerts(1000, 'cyber'), alerts(2000, 'cyber'), alerts(cleared - 1, 'cyber'))
    expect(attacked).toEqual([{ id: 'security', by: 'alert', since: 1000, slot: 'left-top' }])
    expect(ids(after(alerts(1000, 'cyber'), alerts(cleared), alerts(due - 1)))).toEqual(['security'])
    expect(after(alerts(1000, 'cyber'), alerts(cleared), alerts(due))).toEqual([])
  })

  it('stays while the Alert lasts, and for the delay after it has cleared', () => {
    expect(ids(after(alerts(1000, 'gas'), alerts(600_000, 'gas')))).toEqual(['gas'])
    expect(ids(after(alerts(1000, 'gas'), alerts(cleared), alerts(due - 1)))).toEqual(['gas'])
  })

  it('closes once the delay after the clearing has passed', () => {
    expect(after(alerts(1000, 'gas'), alerts(cleared), alerts(due))).toEqual([])
  })

  it('stays when its Alert is raised again before the delay has passed, and counts the delay anew after', () => {
    const again = [alerts(1000, 'gas'), alerts(cleared), alerts(cleared + 1000, 'gas')]
    expect(after(...again, alerts(due, 'gas'))).toEqual([{ id: 'gas', by: 'alert', since: 1000, slot: 'left-top' }])
    expect(ids(after(...again, alerts(due + 1000), alerts(due + 1000 + CLOSE_AFTER_MS - 1)))).toEqual(['gas'])
    expect(after(...again, alerts(due + 1000), alerts(due + 1000 + CLOSE_AFTER_MS))).toEqual([])
  })

  it('stays for the temperature while one of its two Alerts lasts', () => {
    const one = after(alerts(1000, 'thermal', 'predictive'), alerts(cleared, 'predictive'), alerts(due, 'predictive'))
    expect(ids(one)).toEqual(['temperature'])
  })

  it('does not open again, the Alert raised again, once the Operator has closed it', () => {
    const closed = [alerts(1000, 'intrusion'), close]
    expect(after(...closed, alerts(2000, 'intrusion'), alerts(3000, 'intrusion'))).toEqual([])
  })

  it('opens again for a new Alert after the last one cleared', () => {
    const windows = after(alerts(1000, 'intrusion'), close, alerts(cleared), alerts(30_000, 'intrusion'))
    expect(windows).toEqual([{ id: 'camera', by: 'alert', since: 30_000, slot: 'left-top' }])
  })

  it('stays the Operator\'s when the Operator had opened it: the clearing of the Alert does not close it', () => {
    const windows = after(open(500), alerts(1000, 'intrusion'), alerts(cleared), alerts(due), alerts(600_000))
    expect(windows).toEqual([{ id: 'camera', by: 'operator', since: 500, slot: 'left-top' }])
  })

  it('becomes the Operator\'s when the Operator asks for it, and then stays until closed', () => {
    const asked = [alerts(1000, 'intrusion'), open(2000)]
    expect(after(...asked)).toEqual([{ id: 'camera', by: 'operator', since: 1000, slot: 'left-top' }])
    expect(ids(after(...asked, alerts(cleared), alerts(due), alerts(600_000)))).toEqual(['camera'])
    expect(after(...asked, alerts(cleared), close)).toEqual([])
  })

  it('stays when the Operator asks for it during the delay', () => {
    const windows = after(alerts(1000, 'intrusion'), alerts(cleared), open(cleared + 1000), alerts(due))
    expect(windows).toEqual([{ id: 'camera', by: 'operator', since: 1000, slot: 'left-top' }])
  })

  it('makes the window open for the longest give way past the limit, as one the Operator opens does', () => {
    const full = [open(1000, 'gas'), open(2000, 'temperature'), open(3000, 'alerts'), open(4000, 'incidents')]
    const windows = after(...full, alerts(5000, 'intrusion'))
    expect(windows).toHaveLength(MAX_WINDOWS)
    expect(isOpen(windows, 'gas')).toBe(false)
    expect(windows.at(-1)).toEqual({ id: 'camera', by: 'alert', since: 5000, slot: 'left-top' })
  })

  it('does not come back, having given way, while its Alert goes on', () => {
    const windows = after(
      alerts(1000, 'intrusion'),
      open(2000, 'gas'),
      open(3000, 'temperature'),
      open(4000, 'alerts'),
      open(5000, 'incidents'),
      alerts(6000, 'intrusion'),
    )
    expect(isOpen(windows, 'camera')).toBe(false)
  })

  it('closes within the delay of an instant gone back, as when a replay starts or is wound back', () => {
    // Cleared live at 20 s past a far instant, then seen from a replay of long before.
    const far = 1_000_000_000
    const replayed = [alerts(far, 'gas'), alerts(far + cleared), alerts(1000)]
    expect(ids(after(...replayed, alerts(1000 + CLOSE_AFTER_MS - 1)))).toEqual(['gas'])
    expect(after(...replayed, alerts(1000 + CLOSE_AFTER_MS))).toEqual([])
  })

  it('gives back the same state when nothing has changed', () => {
    const calm = stateAfter(open(500, 'incidents'), alerts(1000, 'noise'))
    expect(windowsAfter(calm, alerts(2000, 'noise'))).toBe(calm)
    const raised = stateAfter(alerts(1000, 'gas'))
    expect(windowsAfter(raised, alerts(2000, 'gas'))).toBe(raised)
    const waiting = stateAfter(alerts(1000, 'gas'), alerts(cleared))
    expect(windowsAfter(waiting, alerts(cleared + 1000))).toBe(waiting)
  })
})

describe('a window closed by a shot', () => {
  const shot: WindowEvent = { type: 'close', id: 'camera', by: 'shot' }
  const open_ = (state: WindowsState) => state.open.map(({ id }) => id)

  it('closes as by any other, and is said to have been shot', () => {
    const state = stateAfter(open(), open(2000, 'gas'), shot)
    expect(open_(state)).toEqual(['gas'])
    expect(state.shot).toEqual(['camera'])
  })

  it('is not said so when it was closed otherwise', () => {
    expect(stateAfter(open(), close).shot).toEqual([])
  })

  it('changes nothing when the window was not open', () => {
    expect(windowsAfter(NO_WINDOWS_STATE, shot)).toBe(NO_WINDOWS_STATE)
  })

  it('is no longer said so once open again, however it closes next', () => {
    expect(stateAfter(open(), shot, open(3000)).shot).toEqual([])
    expect(stateAfter(open(), shot, open(3000), close).shot).toEqual([])
    const byAlert = stateAfter(open(), shot, alerts(3000, 'intrusion'), alerts(4000), alerts(4000 + CLOSE_AFTER_MS))
    expect(byAlert).toMatchObject({ open: [], shot: [] })
  })

  it('does not open again, its Alert raised again, when an Alert had opened it', () => {
    const closed = [alerts(1000, 'intrusion'), shot]
    const state = stateAfter(...closed, alerts(2000, 'intrusion'), alerts(3000, 'intrusion'))
    expect(state).toMatchObject({ open: [], shot: ['camera'] })
  })
})

describe('closing every window at once', () => {
  const closeAll: WindowEvent = { type: 'close-all' }

  it('closes them all, the ones an Alert opened too', () => {
    const state = stateAfter(open(1000, 'incidents'), alerts(2000, 'gas', 'intrusion'))
    expect(state.open.map(({ id, by }) => [id, by])).toEqual([
      ['incidents', 'operator'],
      ['gas', 'alert'],
      ['camera', 'alert'],
    ])

    expect(windowsAfter(state, closeAll).open).toEqual([])
  })

  it('leaves closed the window of an Alert that goes on', () => {
    expect(after(alerts(1000, 'gas'), closeAll, alerts(2000, 'gas'))).toEqual([])
    // Another Alert raised opens its own.
    expect(after(alerts(1000, 'gas'), closeAll, alerts(2000, 'gas', 'intrusion')).map(({ id }) => id)).toEqual(['camera'])
  })

  it('says of none that it was shot', () => {
    expect(stateAfter(open(), closeAll).shot).toEqual([])
  })

  it('changes nothing when none is open', () => {
    expect(windowsAfter(NO_WINDOWS_STATE, closeAll)).toBe(NO_WINDOWS_STATE)
  })
})

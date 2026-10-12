import { describe, expect, it } from 'vitest'
import { isOpen, NO_WINDOWS, SLOTS, WINDOW_IDS, WINDOWS, type WindowEvent, type Windows, windowsAfter } from './windows'

const open = (at = 1000): WindowEvent => ({ type: 'open', id: 'camera', by: 'operator', at })
const close: WindowEvent = { type: 'close', id: 'camera' }
const after = (...events: WindowEvent[]): Windows => events.reduce(windowsAfter, NO_WINDOWS)

describe('the windows there are', () => {
  it('have each a French name', () => {
    expect(WINDOW_IDS).toEqual(['camera'])
    expect(WINDOWS.camera.name).toBe('Caméra')
  })

  it('have a slot on either side of the Outpost', () => {
    expect(SLOTS).toEqual(['left', 'right'])
  })
})

describe('windowsAfter', () => {
  it('opens a window: which, by whom, since when, in the first slot', () => {
    expect(after(open(1000))).toEqual([{ id: 'camera', by: 'operator', since: 1000, slot: 'left' }])
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
    expect(after(open(1000), close, open(9000))).toEqual([{ id: 'camera', by: 'operator', since: 9000, slot: 'left' }])
  })

  it('leaves the windows it was given as they were', () => {
    const before = after(open())
    windowsAfter(before, close)
    expect(before).toHaveLength(1)
  })
})

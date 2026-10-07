// The hand control is off until the Operator switches it on: a dashboard without a sensor never looks for
// one. The choice stays with the browser, as the sensor stays with the machine.
const KEY = 'sentinel-x:hand-control'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readEnabled(storage: Storage): boolean {
  try {
    return storage.getItem(KEY) === 'on'
  } catch {
    // A browser that keeps nothing: off, and asked again next time.
    return false
  }
}

export function writeEnabled(storage: Storage, enabled: boolean): void {
  try {
    if (enabled) storage.setItem(KEY, 'on')
    else storage.removeItem(KEY)
  } catch {
    // Not kept: it still holds for this page.
  }
}

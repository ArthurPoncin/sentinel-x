import { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Hand } from '../api/hand-frame'
import type { HandState } from '../stores/hand-store'
import { type HandControl, HandControlContext } from '../stores/hand-store-context'
import type { Reading } from '../utils/interpret'
import type { Steer } from '../utils/steer'

const seconds = () => performance.now() / 1000

function useControl(): HandControl {
  const control = useContext(HandControlContext)
  if (!control) throw new Error('The hand control must be used inside <HandControlProvider>')
  return control
}

// Reads what the interface shows of the hand control and re-renders when the selected part changes, e.g.
// `useHandState((state) => state.pose)`. Select a field as is, as with useLiveFeed.
export function useHandState<T>(select: (state: HandState) => T): T {
  const { store } = useControl()
  return useSyncExternalStore(store.subscribe, () => select(store.getState()))
}

// Whether the hand control is on, and the way to switch it.
export function useHandSwitch(): Pick<HandControl, 'enabled' | 'setEnabled'> {
  const { enabled, setEnabled } = useControl()
  return useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled])
}

// The hands as they are at the instant they are asked for: for what draws them or follows them on every
// frame, without a render in between.
export interface LiveHands {
  hands(): readonly Hand[]
  reading(): Reading
  steer(): Steer | null
}

// Null while the hand control is off: nothing to draw, nothing to follow.
export function useLiveHands(): LiveHands | null {
  const { store, enabled } = useControl()
  return useMemo(
    () =>
      enabled
        ? {
            hands: () => store.hands(seconds()),
            reading: () => store.reading(seconds()),
            steer: () => store.reading(seconds()).steer,
          }
        : null,
    [store, enabled],
  )
}

// Seconds of a replay a fist winds in a second, at full deflection.
export const WIND_SPEED = 8

// Winds what `wind` moves while a fist is held to one side of the sensor: it is told how many whole seconds to
// move by, forward or back, as they add up. Nothing is wound while `active` is false.
export function useHandWind(active: boolean, wind: (seconds: number) => void): void {
  const { store, enabled } = useControl()
  // The latest `wind`, so that a new one does not start the count over.
  const latest = useRef(wind)
  useEffect(() => {
    latest.current = wind
  })

  useEffect(() => {
    if (!enabled || !active) return
    let owed = 0
    let last = seconds()
    let frame = requestAnimationFrame(function step() {
      const now = seconds()
      const rate = store.reading(now).wind
      // Let go, the fraction of a second it still owed is forgotten.
      owed = rate ? owed + rate * WIND_SPEED * Math.min(now - last, 0.1) : 0
      last = now
      const whole = Math.trunc(owed)
      if (whole !== 0) {
        owed -= whole
        latest.current(whole)
      }
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [store, enabled, active])
}

import { useRef } from 'react'
import { panToward } from '../utils/pan'

// Follows the camera's `pan` as the Alerts tell it, in radians: it starts from where the camera rests, and
// turns to each new one. Returns how far the camera is drawn turned `delta` seconds on: call it on every frame.
export function usePan(pan: number): (delta: number) => number {
  const shown = useRef(0)

  return (delta) => {
    shown.current = panToward(shown.current, pan, delta)
    return shown.current
  }
}

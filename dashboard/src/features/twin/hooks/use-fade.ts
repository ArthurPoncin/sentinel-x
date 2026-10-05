import { useMemo, useRef } from 'react'
import { Color } from 'three'
import { fadeTo, fadeValue, settled } from '../utils/fade'

const seconds = () => performance.now() / 1000

// Follows `target` in fades. The first target is shown as it is, each change after that fades in from what
// is on screen. Returns what to show right now: call it on every frame.
export function useFade(target: readonly number[]): () => number[] {
  const fade = useRef(settled(target))

  return () => {
    const now = seconds()
    fade.current = fadeTo(fade.current, target, now)
    return fadeValue(fade.current, now)
  }
}

// The same for a `#rrggbb` color: its channels right now, as three.js mixes them, for Color.fromArray.
export function useColorFade(color: string): () => number[] {
  return useFade(useMemo(() => new Color(color).toArray(), [color]))
}

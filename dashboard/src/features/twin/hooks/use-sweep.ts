import { useRef } from 'react'
import { lapAt, type Sweeps, sweepsAt } from '../utils/presence'

const seconds = () => performance.now() / 1000

// Sweeps the fence while `present`, then lets the sweep in progress go to its end. Returns how far through
// its sweep the fence is right now, 0–1, or null when nothing sweeps it: call it on every frame.
export function useSweep(present: boolean): () => number | null {
  const sweeps = useRef<Sweeps | null>(null)

  return () => {
    const now = seconds()
    sweeps.current = sweepsAt(sweeps.current, present, now)
    return lapAt(sweeps.current, now)
  }
}

import { useRef } from 'react'
import type { Frame } from '@/shared/contract'
import { type Impulse, type ImpulseShape, impulseShape, impulsesAt, telemetryIn } from '../utils/link'
import { framesSince } from '../utils/noise'

const seconds = () => performance.now() / 1000

// Sends an impulse when telemetry is among the frames that come in after the first render: those already in
// `frames` then are past, and none of them is replayed. None leaves while the link is not `live`. Returns the
// impulses over the antenna as they show right now: call it on every frame.
export function useImpulses(frames: readonly Frame[], live: boolean): () => ImpulseShape[] {
  const seen = useRef(frames)
  const impulses = useRef<readonly Impulse[]>([])

  return () => {
    const now = seconds()
    impulses.current = impulsesAt(impulses.current, telemetryIn(framesSince(seen.current, frames)), live, now)
    seen.current = frames
    return impulses.current.flatMap((impulse) => impulseShape(now - impulse.startedAt) ?? [])
  }
}

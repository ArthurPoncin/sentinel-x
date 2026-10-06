import { useRef } from 'react'
import type { Frame } from '@/shared/contract'
import { type Framing, newlyRaised } from '../utils/alert-framing'
import type { SceneProps } from '../utils/scene'

const seconds = () => performance.now() / 1000

// Frames the Alert the scene anchors as it is raised among the frames that come in after the first render:
// those already active then move nothing. The anchor is the one the Alert had as it was raised: sent again
// with the same alert_id, an intruder that has moved does not turn the camera a second time. Returns the
// last Alert framed, or null before the first: call it on every frame.
export function useFraming(anchor: SceneProps['anchor'], frames: readonly Frame[]): () => Framing | null {
  const seen = useRef(frames)
  const framing = useRef<Framing | null>(null)

  return () => {
    const raised = newlyRaised(seen.current, frames)
    seen.current = frames
    if (anchor && raised.includes(anchor.alertId)) framing.current = { anchor: anchor.at, since: seconds() }
    return framing.current
  }
}

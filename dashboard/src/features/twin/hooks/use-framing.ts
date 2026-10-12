import { useRef } from 'react'
import type { Frame } from '@/shared/contract'
import { newlyRaised, type Shots, shotsAfter } from '../utils/alert-framing'
import type { SceneProps } from '../utils/scene'

const seconds = () => performance.now() / 1000

// Frames the Alert the scene anchors as it is raised among the frames that come in after the first render:
// those already active then move nothing. The anchor is the one the Alert had as it was raised: sent again
// with the same alert_id, an intruder that has moved does not turn the camera a second time. `whole` is the
// Alert that is on the whole Outpost, the one the shield is raised for: as it is raised the camera takes a
// wide shot. Returns the last Alert framed and the last wide shot, each null before the first: call it on
// every frame.
export function useFraming(anchor: SceneProps['anchor'], whole: string | null, frames: readonly Frame[]): () => Shots {
  const seen = useRef(frames)
  const shots = useRef<Shots>({ framing: null, wide: null })

  return () => {
    const raised = newlyRaised(seen.current, frames)
    seen.current = frames
    shots.current = shotsAfter(shots.current, raised, anchor, whole, seconds())
    return shots.current
  }
}

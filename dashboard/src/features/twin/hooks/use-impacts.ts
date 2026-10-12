import { useRef } from 'react'
import { type ImpactShape, impactShape, struckBy, unstruck } from '../utils/impact'

const seconds = () => performance.now() / 1000

// Sends an impact on the shield each time its last strike moves on after the first render: `struckAt` is the
// instant of that strike, null while the shield is lowered. The strike it shows then is past, and sends none.
// Returns the waves on the dome as they show right now, each until its end: call it on every frame.
export function useImpacts(struckAt: number | null): () => ImpactShape[] {
  const struck = useRef(unstruck(struckAt))

  return () => {
    const now = seconds()
    struck.current = struckBy(struck.current, struckAt, now)
    return struck.current.impacts.flatMap((impact) => {
      const shape = impactShape(now - impact.startedAt)
      return shape ? [{ at: impact.at, ...shape }] : []
    })
  }
}

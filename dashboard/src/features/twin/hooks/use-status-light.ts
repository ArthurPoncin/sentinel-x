import { useMemo, useRef } from 'react'
import { Color } from 'three'
import { STATUS_COLORS } from '@/shared/config/status-colors'
import type { StatusLevel } from '@/shared/contract'
import { lightShares, lightTo, lit, resting } from '../utils/escalation'

const seconds = () => performance.now() / 1000

// The color of each Status, as three.js mixes them.
const FLOOD: Readonly<Record<StatusLevel, readonly number[]>> = {
  nominal: new Color(STATUS_COLORS.nominal).toArray(),
  elevated: new Color(STATUS_COLORS.elevated).toArray(),
  critical: new Color(STATUS_COLORS.critical).toArray(),
}

// The light of the model, `neutral` but for the Status: a Status that rises floods it in its color for a
// moment, then leaves it a slight tint. The first Status is shown at rest. Returns the light's channels right
// now, for Color.fromArray: call it on every frame.
export function useStatusLight(level: StatusLevel, neutral: string): () => number[] {
  const light = useRef(resting(level))
  const studio = useMemo(() => new Color(neutral).toArray(), [neutral])

  return () => {
    const now = seconds()
    light.current = lightTo(light.current, level, now)
    return lit(lightShares(light.current, now), studio, FLOOD)
  }
}

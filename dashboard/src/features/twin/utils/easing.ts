import type { Color } from 'three'

// How fast what follows the Readings eases toward them: a snapshot a second flows into the next, it does
// not jump. A change of Status does not ease: it fades, over a set time (fade.ts).
export const EASE = 4

// Eases `color` toward `target` over the frame, at the same pace as MathUtils.damp with EASE.
export function ease(color: Color, target: Color, delta: number) {
  color.lerp(target, 1 - Math.exp(-EASE * delta))
}

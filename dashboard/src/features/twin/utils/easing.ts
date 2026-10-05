import type { Color } from 'three'

// How fast what is on screen eases toward the scene: a snapshot a second fades in, it does not jump.
export const EASE = 4

// Eases `color` toward `target` over the frame, at the same pace as MathUtils.damp with EASE.
export function ease(color: Color, target: Color, delta: number) {
  color.lerp(target, 1 - Math.exp(-EASE * delta))
}

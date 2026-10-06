import { FIGURE, figureHeight } from './figure'

// What the label over the intruder reads: what the vision model sees and how sure it is of it, the Alert's
// `confidence` (0–1) rounded to the percent.
export function detectionLabel(confidence: number): string {
  return `PERSONNE · ${Math.round(Math.min(1, Math.max(0, confidence)) * 100)} %`
}

// The frame the vision model's detection is drawn as around the figurine, like a detection in an image: four
// brackets at the corners of a rectangle, in scene units.
export const DETECTION = {
  // How far the frame stands off the figurine, on every side.
  clear: 0.05,
  // Each bracket's two arms: how long along the frame's sides, and how thick.
  arm: 0.09,
  thickness: 0.014,
} as const

// The frame's rectangle: how wide and how tall, and how high above the ground its middle is. It holds the
// figurine from whichever side it is seen.
export function detectionFrame(): { width: number; height: number; middle: number } {
  const reach = FIGURE.shoulder.x + FIGURE.upperArm.radius[0]
  return {
    width: 2 * (reach + DETECTION.clear),
    height: figureHeight() + 2 * DETECTION.clear,
    middle: figureHeight() / 2,
  }
}

// The outline of a bracket, around the frame's middle: [across, up] pairs.
export type Outline = readonly (readonly [x: number, y: number])[]

// The frame's four brackets: at each corner an L whose two arms run along the sides that meet there, inside
// the frame.
export function brackets(): Outline[] {
  const { width, height } = detectionFrame()
  const { arm, thickness } = DETECTION

  return ([-1, 1] as const).flatMap((up) =>
    ([-1, 1] as const).map((across): Outline => {
      const x = (across * width) / 2
      const y = (up * height) / 2
      return [
        [x, y],
        [x - across * arm, y],
        [x - across * arm, y - up * thickness],
        [x - across * thickness, y - up * thickness],
        [x - across * thickness, y - up * arm],
        [x, y - up * arm],
      ]
    }),
  )
}

// The camera turns around this point, halfway up the Enclosure on its mast, and cannot be panned away
// from it, so the Outpost stays centred.
export const TARGET = [0, 1.2, 0] as const
// The camera's vertical field of view, in degrees.
export const FIELD_OF_VIEW = 40
// Everything the Twin shows stands inside a sphere of this radius around the target: the perimeter ring, 3.2
// from the centre on the ground 1.2 below it, and room for its halo to fade out before the edge of the frame.
export const STAGE_RADIUS = 3.8

// Distance from the target at which the camera holds the whole stage in a frame of this aspect ratio
// (width / height). The sphere fits the narrower of the two fields of view, so the stage stays in frame
// wherever the camera stands around it.
export function wholeStageDistance(aspect: number): number {
  const vertical = Math.tan((FIELD_OF_VIEW * Math.PI) / 360)
  const narrower = Math.atan(vertical * Math.min(1, aspect))
  return STAGE_RADIUS / Math.sin(narrower)
}

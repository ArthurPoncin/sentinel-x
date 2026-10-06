// Seconds the camera stays where the Operator left it before the automatic orbit resumes.
export const RESUME_DELAY = 3
// Seconds the orbit then takes to get back to full speed, so it never restarts with a jerk.
export const RESUME_RAMP = 2

// What the Operator last did with the camera. `at` is in seconds, on a clock that only goes forward.
export type CameraTouch = { kind: 'never' } | { kind: 'holding' } | { kind: 'released'; at: number }

// Share of its full speed the orbit is back at, `elapsed` seconds after it resumes.
export function resumeRamp(elapsed: number): number {
  const resumed = Math.min(1, Math.max(0, elapsed / RESUME_RAMP))
  return resumed * resumed * (3 - 2 * resumed)
}

// Share of its full speed the automatic orbit turns at, 0–1.
export function autoOrbitSpeed(touch: CameraTouch, now: number): number {
  if (touch.kind === 'never') return 1
  if (touch.kind === 'holding') return 0
  return resumeRamp(now - touch.at - RESUME_DELAY)
}

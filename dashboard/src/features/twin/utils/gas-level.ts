// The gas Reading (`readings.air`) the Enclosure rests at, and the one it is fully red at. Those of
// the mock feed, which idles around 185 and raises its critical gas Alert at 620: to tune to the
// MQ-2's calibration once the Sentinel sends its own Readings.
export const CALM_AIR = 200
export const CRITICAL_AIR = 620

// How far the gas Reading is from calm: 0 when calm or before any Reading, 1 at critical and beyond.
export function gasLevel(air: number | null): number {
  if (air === null) return 0
  const level = (air - CALM_AIR) / (CRITICAL_AIR - CALM_AIR)
  return Math.min(1, Math.max(0, level))
}

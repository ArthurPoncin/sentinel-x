// The temperature Reading (`readings.temp`, °C) the generator hall's roof rests at, and the one it glows
// fully at. Those of the mock feed, which idles around 31 and peaks at 41: to tune to the site once the
// Sentinel sends its own Readings.
export const CALM_TEMP = 31.5
export const PEAK_TEMP = 41

// How far the temperature Reading is from calm: 0 when calm or before any Reading, 1 at the peak and beyond.
export function heatLevel(temp: number | null): number {
  if (temp === null) return 0
  const level = (temp - CALM_TEMP) / (PEAK_TEMP - CALM_TEMP)
  return Math.min(1, Math.max(0, level))
}

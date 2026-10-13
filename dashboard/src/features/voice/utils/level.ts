// How loud the microphone is over these samples, from 0, silence, to 1: the root of their mean power, on a
// curve that leaves a quiet room near nothing and brings a voice at arm's length to the middle.
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let power = 0
  for (const sample of samples) power += sample * sample
  return Math.min(1, Math.sqrt(Math.sqrt(power / samples.length)) * 2)
}

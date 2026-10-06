import { useRef } from 'react'
import type { Frame } from '@/shared/contract'
import { clapsIn, framesSince, type Wave, type WaveShape, waveShape, wavesAt } from '../utils/noise'

const seconds = () => performance.now() / 1000

// Sends a wave for each `noise` Alert raised among the frames that come in after the first render: those
// already in `frames` then are past, and none of them is replayed. Returns the waves on the socle as they
// show right now, each until its end, whatever comes after: call it on every frame.
export function useWaves(frames: readonly Frame[]): () => WaveShape[] {
  const seen = useRef(frames)
  const waves = useRef<readonly Wave[]>([])

  return () => {
    const now = seconds()
    waves.current = wavesAt(waves.current, clapsIn(framesSince(seen.current, frames)), now)
    seen.current = frames
    return waves.current.flatMap((wave) => waveShape(now - wave.startedAt, wave.amplitude) ?? [])
  }
}

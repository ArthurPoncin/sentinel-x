import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Frame } from '@/shared/contract'
import { framesAt, instantAt, lengthOf, type Replay } from '../utils/replay'

// How long a second of a replay lasts on screen: real time, second by second.
export const SECOND_MS = 1000

export interface Player {
  // What is replayed, or null while the Twin is live.
  replay: Replay | null
  // Where the scrubber stands, in seconds from the replay's start, 0 to `length`.
  second: number
  length: number
  // The instant it stands at, in ms since the epoch.
  at: number
  playing: boolean
  // What the Twin is rebuilt from: the frames received by `at`, oldest first. Null while live.
  frames: readonly Frame[] | null
  // Starts a replay from its first second, playing.
  load(replay: Replay): void
  seek(second: number): void
  // Plays or pauses; played again from its end, a replay starts over.
  toggle(): void
  // Back to live.
  stop(): void
}

// Plays a replay one second every SECOND_MS, stops at its last second and holds it there until it is played
// again or left: the Twin never goes back to live on its own.
export function usePlayer(): Player {
  const [replay, setReplay] = useState<Replay | null>(null)
  const [second, setSecond] = useState(0)
  const [playing, setPlaying] = useState(false)
  const length = replay ? lengthOf(replay) : 0

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setSecond((current) => Math.min(current + 1, length)), SECOND_MS)
    return () => clearInterval(timer)
  }, [playing, length])

  useEffect(() => {
    if (playing && second >= length) setPlaying(false)
  }, [playing, second, length])

  const at = replay ? instantAt(replay, second) : 0
  const frames = useMemo(() => (replay ? framesAt(replay, at) : null), [replay, at])

  const load = useCallback((next: Replay) => {
    setReplay(next)
    setSecond(0)
    setPlaying(true)
  }, [])
  const seek = useCallback((to: number) => setSecond(Math.min(Math.max(0, Math.round(to)), length)), [length])
  const toggle = useCallback(() => {
    if (playing) return setPlaying(false)
    if (second >= length) setSecond(0)
    setPlaying(true)
  }, [playing, second, length])
  const stop = useCallback(() => {
    setReplay(null)
    setSecond(0)
    setPlaying(false)
  }, [])

  return { replay, second, length, at, playing, frames, load, seek, toggle, stop }
}

import type { Heard } from '../utils/interpret'

// Why the ear could not listen, or stopped: the microphone refused, none on this machine, one that cannot be
// read or went away, a browser that cannot, one that keeps the sound asleep, or the model that did not load.
export type Failure = 'refused' | 'no-microphone' | 'unavailable' | 'unsupported' | 'blocked' | 'model'

// Where the ear is, from the switch to the first word: waiting for another tab of this browser to be done
// listening, the microphone asked for, the model loading, listening.
export type EarState = 'waiting' | 'asking' | 'loading' | 'listening'

// What the ear gives: its own life, how loud the microphone is, from 0 to 1 and some times a second, each
// sentence once it is said, and why it stopped when it could not go on.
export type EarEvent =
  | { type: 'ear'; state: EarState }
  | { type: 'level'; level: number }
  | { type: 'heard'; heard: Heard }
  | { type: 'failed'; reason: Failure }

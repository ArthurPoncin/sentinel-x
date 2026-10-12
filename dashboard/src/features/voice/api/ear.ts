import type { Heard } from '../utils/interpret'

// Why the ear could not listen: the microphone refused, none on this machine, a browser that cannot, or the
// model that did not load.
export type Failure = 'refused' | 'no-microphone' | 'unsupported' | 'model'

// Where the ear is, from the switch to the first word: the microphone asked for, the model loading, listening.
export type EarState = 'asking' | 'loading' | 'listening'

// What the ear gives: its own life, each sentence once it is said, and why it stopped when it could not go on.
export type EarEvent = { type: 'ear'; state: EarState } | { type: 'heard'; heard: Heard } | { type: 'failed'; reason: Failure }

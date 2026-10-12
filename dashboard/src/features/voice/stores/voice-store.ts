import type { EarEvent, EarState, Failure } from '../api/ear'
import { ASLEEP, type Command, interpret, type Outcome, UNKNOWN } from '../utils/interpret'

// What the interface shows of the voice control.
export interface VoiceState {
  // Where the ear is: 'off' while the voice control is, 'awake' while a command is taken.
  status: 'off' | EarState | 'awake'
  // The last sentence heard, and what was made of it.
  last: { text: string; outcome: Outcome } | null
}

export const VOICE_OFF: VoiceState = { status: 'off', last: null }

// A sentence that asked for nothing though it was meant to: after the wake word, words that are no command,
// or a command the engine was not sure enough of.
export type Missed = 'unknown' | 'unsure'

// Seconds the ear stays deaf after the dashboard's last word: the engine gives a sentence once it is over, and
// the room gives the voice back a moment longer.
export const ECHO_TAIL = 1

export interface VoiceStore {
  getState(): VoiceState
  subscribe(listener: () => void): () => void
  // Takes what the ear gives, at `now` in seconds on a clock that only goes forward.
  dispatch(event: EarEvent, now: number): void
  // Called now and then while nothing is said: notices the wake window that is over.
  tick(now: number): void
  // Back to 'off', as the voice control is switched off.
  reset(): void
  // Told whether the dashboard talks, at `now`: while it does, and a short while after, nothing heard is a
  // command. It would hear its own voice.
  deafen(talking: boolean, now: number): void
  // Whether what the microphone gives at `now` is the dashboard's own voice.
  deaf(now: number): boolean
  // Told of each command a sentence asks for, once.
  onCommand(listener: (command: Command) => void): () => void
  // Told why the ear stopped, when it could not listen.
  onFailure(listener: (failure: Failure) => void): () => void
  // Told of each sentence that was meant as a command and is none: there is something to answer.
  onMissed(listener: (missed: Missed) => void): () => void
}

// Whether a sentence has a word in it: a noise and a silence have none.
const worded = (text: string) => text.split(/\s+/).some((word) => word !== '' && word !== UNKNOWN)

export function createVoiceStore(): VoiceStore {
  let state = VOICE_OFF
  let wake = ASLEEP
  let talking = false
  let deafUntil = -Infinity
  const listeners = new Set<() => void>()
  const commandListeners = new Set<(command: Command) => void>()
  const failureListeners = new Set<(failure: Failure) => void>()
  const missedListeners = new Set<(missed: Missed) => void>()

  const show = (next: VoiceState) => {
    if (next.status === state.status && next.last === state.last) return
    state = next
    for (const listener of listeners) listener()
  }

  const off = () => {
    wake = ASLEEP
    show(VOICE_OFF)
  }

  const deaf = (now: number) => talking || now <= deafUntil

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(event, now) {
      if (event.type === 'failed') {
        off()
        for (const listener of failureListeners) listener(event.reason)
        return
      }
      if (event.type === 'ear') return show({ ...state, status: event.state })
      // A sentence that comes before the ear listens, or after the voice control was switched off, is nobody's.
      if (state.status !== 'listening' && state.status !== 'awake') return
      // The dashboard's own voice, wake word and wordings included: not a sentence of the Operator's.
      if (deaf(now)) return
      const { text } = event.heard
      const awake = now <= wake.until
      const { outcome, wake: next } = interpret(wake, event.heard, now)
      wake = next
      show({
        status: now <= wake.until ? 'awake' : 'listening',
        last: worded(text) ? { text, outcome } : state.last,
      })
      if (outcome.kind === 'command') for (const listener of commandListeners) listener(outcome.command)
      // A noise in the wake window is no sentence, nothing was meant by it; and a wake word the engine doubts
      // may be a conversation nearby, which is not to be answered aloud.
      else if (worded(text) && (outcome.kind === 'unknown' || (outcome.kind === 'unsure' && awake))) {
        for (const listener of missedListeners) listener(outcome.kind)
      }
    },
    tick(now) {
      if (state.status === 'awake' && now > wake.until) show({ ...state, status: 'listening' })
    },
    reset: off,
    deafen(next, now) {
      if (talking && !next) deafUntil = now + ECHO_TAIL
      talking = next
    },
    deaf,
    onCommand(listener) {
      commandListeners.add(listener)
      return () => commandListeners.delete(listener)
    },
    onFailure(listener) {
      failureListeners.add(listener)
      return () => failureListeners.delete(listener)
    },
    onMissed(listener) {
      missedListeners.add(listener)
      return () => missedListeners.delete(listener)
    },
  }
}

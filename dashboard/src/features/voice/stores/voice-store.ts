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

export interface VoiceStore {
  getState(): VoiceState
  subscribe(listener: () => void): () => void
  // Takes what the ear gives, at `now` in seconds on a clock that only goes forward.
  dispatch(event: EarEvent, now: number): void
  // Called now and then while nothing is said: notices the wake window that is over.
  tick(now: number): void
  // Back to 'off', as the voice control is switched off.
  reset(): void
  // Told of each command a sentence asks for, once.
  onCommand(listener: (command: Command) => void): () => void
  // Told why the ear stopped, when it could not listen.
  onFailure(listener: (failure: Failure) => void): () => void
}

// Whether a sentence has a word in it: a noise and a silence have none.
const worded = (text: string) => text.split(/\s+/).some((word) => word !== '' && word !== UNKNOWN)

export function createVoiceStore(): VoiceStore {
  let state = VOICE_OFF
  let wake = ASLEEP
  const listeners = new Set<() => void>()
  const commandListeners = new Set<(command: Command) => void>()
  const failureListeners = new Set<(failure: Failure) => void>()

  const show = (next: VoiceState) => {
    if (next.status === state.status && next.last === state.last) return
    state = next
    for (const listener of listeners) listener()
  }

  const off = () => {
    wake = ASLEEP
    show(VOICE_OFF)
  }

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
      const { text } = event.heard
      const interpreted = interpret(wake, event.heard, now)
      wake = interpreted.wake
      show({
        status: now <= wake.until ? 'awake' : 'listening',
        last: worded(text) ? { text, outcome: interpreted.outcome } : state.last,
      })
      if (interpreted.outcome.kind === 'command') for (const listener of commandListeners) listener(interpreted.outcome.command)
    },
    tick(now) {
      if (state.status === 'awake' && now > wake.until) show({ ...state, status: 'listening' })
    },
    reset: off,
    onCommand(listener) {
      commandListeners.add(listener)
      return () => commandListeners.delete(listener)
    },
    onFailure(listener) {
      failureListeners.add(listener)
      return () => failureListeners.delete(listener)
    },
  }
}

import { describe, expect, it } from 'vitest'
import type { Failure } from '../api/ear'
import { type Command, WAKE_WINDOW } from '../utils/interpret'
import { createVoiceStore, VOICE_OFF } from './voice-store'

// A store that listens, with what it told of.
function listening() {
  const store = createVoiceStore()
  const commands: Command[] = []
  const failures: Failure[] = []
  store.onCommand((command) => commands.push(command))
  store.onFailure((failure) => failures.push(failure))
  store.dispatch({ type: 'ear', state: 'listening' }, 0)
  return { store, commands, failures }
}

const heard = (text: string, confidence = 1) => ({ type: 'heard' as const, heard: { text, confidence } })

describe('the voice store', () => {
  it('is off until the microphone is asked for, then says where the ear is', () => {
    const store = createVoiceStore()
    expect(store.getState()).toEqual(VOICE_OFF)

    store.dispatch({ type: 'ear', state: 'asking' }, 0)
    expect(store.getState().status).toBe('asking')
    store.dispatch({ type: 'ear', state: 'loading' }, 0)
    expect(store.getState().status).toBe('loading')
    store.dispatch({ type: 'ear', state: 'listening' }, 0)
    expect(store.getState().status).toBe('listening')
  })

  it('wakes on the wake word, and goes back to listening once the wake window is over', () => {
    const { store, commands } = listening()

    store.dispatch(heard('sentinelle'), 10)
    expect(store.getState()).toEqual({ status: 'awake', last: { text: 'sentinelle', outcome: { kind: 'woken' } } })

    store.tick(10 + WAKE_WINDOW - 0.1)
    expect(store.getState().status).toBe('awake')
    store.tick(10 + WAKE_WINDOW + 0.1)
    expect(store.getState().status).toBe('listening')
    expect(commands).toEqual([])
  })

  it('tells of a command once, shows the sentence it came in, and goes back to listening', () => {
    const { store, commands } = listening()

    store.dispatch(heard('sentinelle coupe la sirène'), 10)

    expect(commands).toEqual(['siren-off'])
    expect(store.getState()).toEqual({
      status: 'listening',
      last: { text: 'sentinelle coupe la sirène', outcome: { kind: 'command', command: 'siren-off' } },
    })
  })

  it('takes the command in the sentence after the wake word', () => {
    const { store, commands } = listening()

    store.dispatch(heard('sentinelle'), 10)
    store.dispatch(heard('déclenche la sirène'), 12)

    expect(commands).toEqual(['siren'])
    expect(store.getState().status).toBe('listening')
  })

  it('shows what it did not take, and why', () => {
    const { store, commands } = listening()

    store.dispatch(heard('coupe la sirène'), 10)
    expect(store.getState().last).toEqual({ text: 'coupe la sirène', outcome: { kind: 'ignored' } })
    store.dispatch(heard('sentinelle [unk]'), 20)
    expect(store.getState().last).toEqual({ text: 'sentinelle [unk]', outcome: { kind: 'unknown' } })
    store.dispatch(heard('sentinelle coupe la sirène', 0.1), 30)
    expect(store.getState().last).toEqual({ text: 'sentinelle coupe la sirène', outcome: { kind: 'unsure' } })
    expect(commands).toEqual([])
  })

  it('keeps the last sentence over a noise and a silence', () => {
    const { store } = listening()
    store.dispatch(heard('sentinelle coupe la sirène'), 10)
    const { last } = store.getState()

    store.dispatch(heard('[unk]'), 20)
    store.dispatch(heard(''), 21)

    expect(store.getState().last).toBe(last)
  })

  it('goes off and says why when the ear could not listen', () => {
    const store = createVoiceStore()
    const failures: Failure[] = []
    store.onFailure((failure) => failures.push(failure))
    store.dispatch({ type: 'ear', state: 'asking' }, 0)

    store.dispatch({ type: 'failed', reason: 'refused' }, 1)

    expect(store.getState()).toEqual(VOICE_OFF)
    expect(failures).toEqual(['refused'])
  })

  it('hears nothing while it is off', () => {
    const store = createVoiceStore()
    const commands: Command[] = []
    store.onCommand((command) => commands.push(command))

    store.dispatch(heard('sentinelle coupe la sirène'), 10)

    expect(commands).toEqual([])
    expect(store.getState()).toEqual(VOICE_OFF)
  })

  it('forgets everything as it is switched off', () => {
    const { store, commands } = listening()
    store.dispatch(heard('sentinelle'), 10)

    store.reset()
    expect(store.getState()).toEqual(VOICE_OFF)

    // Switched on again within the wake window: the wake word is to be said again.
    store.dispatch({ type: 'ear', state: 'listening' }, 11)
    store.dispatch(heard('coupe la sirène'), 12)
    expect(commands).toEqual([])
  })
})

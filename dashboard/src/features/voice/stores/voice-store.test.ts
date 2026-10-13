import { describe, expect, it } from 'vitest'
import type { Failure } from '../api/ear'
import { type Command, WAKE_WINDOW } from '../utils/interpret'
import { createVoiceStore, ECHO_TAIL, type Missed, VOICE_OFF } from './voice-store'

// A store that listens, with what it told of.
function listening() {
  const store = createVoiceStore()
  const commands: Command[] = []
  const failures: Failure[] = []
  const missed: Missed[] = []
  store.onCommand((command) => commands.push(command))
  store.onFailure((failure) => failures.push(failure))
  store.onMissed((miss) => missed.push(miss))
  store.dispatch({ type: 'ear', state: 'listening' }, 0)
  return { store, commands, failures, missed }
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

  it('tells of what it did not understand and of what it was not sure of, never of a conversation nearby', () => {
    const { store, missed } = listening()

    store.dispatch(heard('coupe la sirène'), 10)
    expect(missed).toEqual([])

    store.dispatch(heard('sentinelle la sirène'), 20)
    expect(missed).toEqual(['unknown'])
    // Still awake: the command is the Operator's, and the engine doubts it.
    store.dispatch(heard('coupe la sirène', 0.1), 21)
    expect(missed).toEqual(['unknown', 'unsure'])
  })

  it('tells of nothing for a wake word it is not sure of: it may be no one calling', () => {
    const { store, missed } = listening()

    store.dispatch(heard('sentinelle', 0.1), 10)
    store.dispatch(heard('sentinelle coupe la sirène', 0.1), 20)

    expect(missed).toEqual([])
    expect(store.getState().last?.outcome).toEqual({ kind: 'unsure' })
  })

  it('tells of nothing for a noise in the wake window: there is nothing to answer', () => {
    const { store, missed } = listening()

    store.dispatch(heard('sentinelle'), 10)
    store.dispatch(heard('[unk]'), 11)
    store.dispatch(heard(''), 12)

    expect(missed).toEqual([])
  })

  it('hears nothing while the dashboard talks: its own sentence is no command', () => {
    const { store, commands, missed } = listening()

    store.deafen(true, 10)
    expect(store.deaf(11)).toBe(true)
    // An announcement with the wake word and a wording in it, as the microphone gives it back.
    store.dispatch(heard('sentinelle coupe la sirène'), 11)
    store.dispatch(heard('sentinelle'), 12)
    store.dispatch(heard('sentinelle [unk]'), 13)

    expect(commands).toEqual([])
    expect(missed).toEqual([])
    expect(store.getState()).toEqual({ status: 'listening', last: null })
  })

  it('stays deaf a short while after the last word, then hears again', () => {
    const { store, commands } = listening()
    store.deafen(true, 10)
    store.deafen(false, 14)

    // The end of the sentence, which the engine gives once it is over.
    store.dispatch(heard('sentinelle coupe la sirène'), 14 + ECHO_TAIL - 0.1)
    expect(store.deaf(14 + ECHO_TAIL - 0.1)).toBe(true)
    expect(commands).toEqual([])

    expect(store.deaf(14 + ECHO_TAIL + 0.1)).toBe(false)
    store.dispatch(heard('sentinelle coupe la sirène'), 14 + ECHO_TAIL + 0.1)
    expect(commands).toEqual(['siren-off'])
  })

  it('is not deaf before the dashboard ever talked, nor made so by a voice that was not talking', () => {
    const { store } = listening()
    expect(store.deaf(0)).toBe(false)

    store.deafen(false, 5)
    expect(store.deaf(5)).toBe(false)
  })

  it('stays deaf over a switch off and on, while the dashboard still talks', () => {
    const { store, commands } = listening()
    store.deafen(true, 10)

    store.reset()
    store.dispatch({ type: 'ear', state: 'listening' }, 11)
    store.dispatch(heard('sentinelle coupe la sirène'), 12)

    expect(commands).toEqual([])
  })

  it('tells how loud the microphone is, without a change of state, and nothing while the dashboard talks', () => {
    const { store } = listening()
    const levels: number[] = []
    let shown = 0
    store.onLevel((level) => levels.push(level))
    store.subscribe(() => shown++)

    store.dispatch({ type: 'level', level: 0.4 }, 1)
    store.deafen(true, 2)
    store.dispatch({ type: 'level', level: 0.8 }, 3)
    store.deafen(false, 4)
    store.dispatch({ type: 'level', level: 0.8 }, 4 + ECHO_TAIL / 2)
    store.dispatch({ type: 'level', level: 0.6 }, 4 + ECHO_TAIL + 1)

    expect(levels).toEqual([0.4, 0, 0, 0.6])
    expect(shown).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { ASLEEP, type Command, GRAMMAR, interpret, THRESHOLD, UNKNOWN, WAKE_WINDOW, WAKE_WORD, WORDINGS } from './interpret'

// A sentence the engine is sure of.
const said = (text: string, confidence = 1) => ({ text, confidence })

describe('interpret', () => {
  it('takes no command without the wake word', () => {
    const heard = interpret(ASLEEP, said('coupe la sirène'), 10)

    expect(heard.outcome).toEqual({ kind: 'ignored' })
    expect(heard.wake).toEqual(ASLEEP)
  })

  it('takes a command said in the same sentence as the wake word', () => {
    const heard = interpret(ASLEEP, said('sentinelle coupe la sirène'), 10)

    expect(heard.outcome).toEqual({ kind: 'command', command: 'siren-off' })
  })

  it('wakes on the wake word alone, and takes the command in the sentence that follows', () => {
    const woken = interpret(ASLEEP, said('sentinelle'), 10)
    expect(woken.outcome).toEqual({ kind: 'woken' })
    expect(woken.wake).toEqual({ until: 10 + WAKE_WINDOW })

    const heard = interpret(woken.wake, said('déclenche la sirène'), 10 + WAKE_WINDOW - 0.1)
    expect(heard.outcome).toEqual({ kind: 'command', command: 'siren' })
    // One wake word, one command: the next sentence is nobody's.
    expect(heard.wake).toEqual(ASLEEP)
  })

  it('takes nothing once the wake window is over', () => {
    const { wake } = interpret(ASLEEP, said('sentinelle'), 10)

    expect(interpret(wake, said('déclenche la sirène'), 10 + WAKE_WINDOW + 0.1).outcome).toEqual({ kind: 'ignored' })
  })

  it('says it did not understand what follows the wake word and is no command', () => {
    // The engine gives `[unk]` for what is not in its grammar.
    expect(interpret(ASLEEP, said('sentinelle [unk]'), 10).outcome).toEqual({ kind: 'unknown' })
    expect(interpret(ASLEEP, said('sentinelle la sirène'), 10).outcome).toEqual({ kind: 'unknown' })

    const { wake } = interpret(ASLEEP, said('sentinelle'), 10)
    expect(interpret(wake, said('[unk]'), 12).outcome).toEqual({ kind: 'unknown' })
    expect(interpret(wake, said('coupe la'), 12).outcome).toEqual({ kind: 'unknown' })
  })

  it('leaves the Operator the rest of the wake window to say it again', () => {
    const missed = interpret(ASLEEP, said('sentinelle [unk]'), 10)
    expect(missed.wake).toEqual({ until: 10 + WAKE_WINDOW })

    const again = interpret(missed.wake, said('[unk]'), 12)
    expect(again.wake).toEqual({ until: 10 + WAKE_WINDOW })
    expect(interpret(again.wake, said('coupe la sirène'), 14).outcome).toEqual({ kind: 'command', command: 'siren-off' })
  })

  it('hears through a noise around the command', () => {
    expect(interpret(ASLEEP, said('[unk] sentinelle [unk] coupe la sirène [unk]'), 10).outcome).toEqual({
      kind: 'command',
      command: 'siren-off',
    })
  })

  it('takes no command with a word it did not know inside it: the sentence may say not to', () => {
    // « Sentinelle, ne coupe pas la sirène », as a closed grammar hears it.
    const negated = interpret(ASLEEP, said('sentinelle [unk] coupe [unk] la sirène'), 10)
    expect(negated.outcome).toEqual({ kind: 'unknown' })

    expect(interpret(ASLEEP, said('sentinelle déclenche [unk] la sirène'), 10).outcome).toEqual({ kind: 'unknown' })
    expect(interpret(negated.wake, said('coupe [unk] la sirène'), 12).outcome).toEqual({ kind: 'unknown' })
  })

  it('does nothing about a command it is not sure of, and says so', () => {
    const doubted = interpret(ASLEEP, said('sentinelle coupe la sirène', THRESHOLD - 0.01), 10)
    expect(doubted).toEqual({ wake: ASLEEP, outcome: { kind: 'unsure' } })

    expect(interpret(ASLEEP, said('sentinelle coupe la sirène', THRESHOLD), 10).outcome.kind).toBe('command')
  })

  it('keeps the wake window open after a command it was not sure of', () => {
    const { wake } = interpret(ASLEEP, said('sentinelle'), 10)

    expect(interpret(wake, said('coupe la sirène', 0.1), 12)).toEqual({ wake, outcome: { kind: 'unsure' } })
  })

  it('does not wake on a wake word it is not sure of', () => {
    expect(interpret(ASLEEP, said('sentinelle', 0.1), 10)).toEqual({ wake: ASLEEP, outcome: { kind: 'unsure' } })
  })

  it('does not wake on a wake word it is not sure of, whatever follows it', () => {
    expect(interpret(ASLEEP, said('sentinelle [unk]', 0.2), 10)).toEqual({ wake: ASLEEP, outcome: { kind: 'unsure' } })
    expect(interpret(ASLEEP, said('sentinelle la sirène', 0.2), 10)).toEqual({ wake: ASLEEP, outcome: { kind: 'unsure' } })

    // Awake, it does not push the window further either.
    const { wake } = interpret(ASLEEP, said('sentinelle'), 10)
    expect(interpret(wake, said('sentinelle [unk]', 0.2), 12)).toEqual({ wake, outcome: { kind: 'unsure' } })
  })

  it('makes nothing of a noise, nor of a silence', () => {
    expect(interpret(ASLEEP, said('[unk]'), 10).outcome).toEqual({ kind: 'ignored' })
    expect(interpret(ASLEEP, said(''), 10).outcome).toEqual({ kind: 'ignored' })

    const { wake } = interpret(ASLEEP, said('sentinelle'), 10)
    expect(interpret(wake, said(''), 12)).toEqual({ wake, outcome: { kind: 'ignored' } })
  })

  it('takes each command by each of its wordings, in one sentence or in two', () => {
    expect(WORDINGS['siren-off']).toEqual(['coupe la sirène', 'arrête la sirène', 'stoppe la sirène'])
    expect(WORDINGS.siren).toEqual(['déclenche la sirène', 'lance la sirène', 'active la sirène'])

    for (const command of Object.keys(WORDINGS) as Command[]) {
      for (const wording of WORDINGS[command]) {
        expect(interpret(ASLEEP, said(`sentinelle ${wording}`), 10).outcome).toEqual({ kind: 'command', command })

        const { wake } = interpret(ASLEEP, said('sentinelle'), 10)
        expect(interpret(wake, said(wording), 12).outcome).toEqual({ kind: 'command', command })
      }
    }
  })
})

describe('GRAMMAR', () => {
  it('is all the engine may hear: the wake word, each wording, and anything else as unknown', () => {
    expect(GRAMMAR).toEqual([WAKE_WORD, ...WORDINGS.siren, ...WORDINGS['siren-off'], UNKNOWN])
  })
})

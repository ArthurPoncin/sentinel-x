import { describe, expect, it } from 'vitest'
import { ACKNOWLEDGEMENTS, acknowledge, type Reply } from './acknowledge'
import { type Command, WAKE_WORD, WORDINGS } from './interpret'

const COMMANDS = Object.keys(WORDINGS) as Command[]

// What is answered to a command that was not carried out, or not understood.
const NOT_DONE: readonly Reply[] = [
  'unknown',
  'unsure',
  'only-tried',
  'already-there',
  'nothing-to-replay',
  'incidents-unreachable',
  'alarm-failed',
]

describe('acknowledge', () => {
  it('has a few sentences for each command taken, a choice among them', () => {
    for (const command of COMMANDS) {
      expect(ACKNOWLEDGEMENTS[command].length).toBeGreaterThanOrEqual(2)
      expect(new Set(ACKNOWLEDGEMENTS[command]).size).toBe(ACKNOWLEDGEMENTS[command].length)
    }
  })

  it('has its own for a command refused, one not understood, and one that failed', () => {
    for (const reply of NOT_DONE) {
      expect(ACKNOWLEDGEMENTS[reply].length).toBeGreaterThanOrEqual(1)
      for (const command of COMMANDS) expect(ACKNOWLEDGEMENTS[command]).not.toEqual(expect.arrayContaining([...ACKNOWLEDGEMENTS[reply]]))
    }
  })

  it('answers nothing else than commands and what went wrong with one', () => {
    expect(Object.keys(ACKNOWLEDGEMENTS).toSorted()).toEqual([...COMMANDS, ...NOT_DONE].toSorted())
  })

  it('picks one of the sentences, whichever the draw', () => {
    const every = ACKNOWLEDGEMENTS.siren

    expect(acknowledge('siren', () => 0)).toBe(every[0])
    expect(acknowledge('siren', () => 0.999)).toBe(every.at(-1))
    for (let draw = 0; draw < 1; draw += 0.05) expect(every).toContain(acknowledge('siren', () => draw))
    expect(every).toContain(acknowledge('siren'))
  })

  it('is short, a sentence each: an answer, not a speech', () => {
    for (const sentence of Object.values(ACKNOWLEDGEMENTS).flat()) {
      expect(sentence.length).toBeLessThanOrEqual(60)
      expect(sentence).toMatch(/[.!?]$/)
    }
  })

  it('never says the wake word', () => {
    for (const sentence of Object.values(ACKNOWLEDGEMENTS).flat()) expect(sentence.toLowerCase()).not.toContain(WAKE_WORD)
  })

  it('says of the siren that failed what happened to it, not that it sounds', () => {
    expect(ACKNOWLEDGEMENTS['alarm-failed'].join(' ')).toMatch(/pas/)
    for (const done of [...ACKNOWLEDGEMENTS.siren, ...ACKNOWLEDGEMENTS['siren-off']]) {
      expect(ACKNOWLEDGEMENTS['alarm-failed']).not.toContain(done)
    }
  })
})

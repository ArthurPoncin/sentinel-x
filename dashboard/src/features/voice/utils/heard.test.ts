import { describe, expect, it } from 'vitest'
import { heardFrom } from './heard'

const word = (text: string, conf: number) => ({ word: text, conf, start: 0, end: 0 })

describe('heardFrom', () => {
  it('is as sure of a sentence as of the word it is least sure of', () => {
    const result = { text: 'sentinelle coupe la sirène', result: [word('sentinelle', 1), word('coupe', 0.62), word('la', 0.9), word('sirène', 1)] }

    expect(heardFrom(result)).toEqual({ text: 'sentinelle coupe la sirène', confidence: 0.62 })
  })

  it('does not count what it did not know for a word', () => {
    const result = { text: '[unk] sentinelle', result: [word('[unk]', 0.2), word('sentinelle', 0.95)] }

    expect(heardFrom(result).confidence).toBe(0.95)
  })

  it('is sure of nothing when the engine gives no word', () => {
    expect(heardFrom({ text: '' })).toEqual({ text: '', confidence: 0 })
    expect(heardFrom({ text: 'sentinelle' })).toEqual({ text: 'sentinelle', confidence: 0 })
  })
})

import { type Heard, UNKNOWN } from './interpret'

// A sentence as the engine gives it once it is said: its text, and each word with how sure it is of it.
export interface EngineResult {
  text: string
  result?: readonly { word: string; conf: number }[]
}

// The sentence the interpreter is asked about: as sure as its least sure word, a word it did not know apart.
// Without the words' confidences nothing is sure: the engine was not asked for them, and no command goes.
export function heardFrom({ text, result = [] }: EngineResult): Heard {
  const known = result.filter(({ word }) => word !== UNKNOWN)
  return { text, confidence: known.length === 0 ? 0 : Math.min(...known.map(({ conf }) => conf)) }
}

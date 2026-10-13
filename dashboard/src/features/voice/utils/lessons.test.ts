import { describe, expect, it } from 'vitest'
import { type Command, WAKE_WORD, WORDINGS } from './interpret'
import { CHAPTERS, completed, LESSONS } from './lessons'

const COMMANDS = Object.keys(WORDINGS) as Command[]

describe('the lessons of the voice', () => {
  it('start with the wake word, by itself', () => {
    expect(LESSONS[0]?.id).toBe('wake')
    expect(LESSONS[0]?.wordings).toEqual([WAKE_WORD])
    expect(CHAPTERS[0]?.lessons.map(({ id }) => id)).toEqual(['wake'])
  })

  it('have each command of the vocabulary, once', () => {
    expect(LESSONS.slice(1).map(({ id }) => id).toSorted()).toEqual(COMMANDS.toSorted())
  })

  it('give each command with every way of saying it, and what it does', () => {
    for (const { id, title, wordings, does } of LESSONS) {
      if (id !== 'wake') expect(wordings).toEqual(WORDINGS[id])
      expect(wordings.length).toBeGreaterThanOrEqual(1)
      expect(title).toMatch(/^\p{Lu}/u)
      expect(does).toMatch(/\.$/)
    }
    expect(new Set(LESSONS.map(({ title }) => title)).size).toBe(LESSONS.length)
  })
})

describe('completed', () => {
  it('is the wake word lesson for the wake word said by itself', () => {
    expect(completed({ kind: 'woken' })).toEqual(['wake'])
  })

  it('is the lesson of the command that was said', () => {
    for (const command of COMMANDS) expect(completed({ kind: 'command', command })).toEqual([command])
  })

  it('is none for a sentence that asked for nothing', () => {
    expect(completed({ kind: 'ignored' })).toEqual([])
    expect(completed({ kind: 'unknown' })).toEqual([])
    expect(completed({ kind: 'unsure' })).toEqual([])
  })
})

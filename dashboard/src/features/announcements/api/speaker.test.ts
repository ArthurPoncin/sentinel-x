import { describe, expect, it } from 'vitest'
import { QUEUE_LIMIT } from '../utils/queue'
import { createSpeaker, frenchVoice, type Synthesis } from './speaker'

const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice

const HORTENSE = voice('Microsoft Hortense', 'fr-FR')
const ZIRA = voice('Microsoft Zira', 'en-US')

// A browser's synthesis that says nothing: what it was handed, and the way to end the sentence it is on.
function synthesis(voices: SpeechSynthesisVoice[]) {
  const spoken: SpeechSynthesisUtterance[] = []
  const fake: Synthesis = {
    getVoices: () => voices,
    speak: (utterance) => void spoken.push(utterance),
    cancel: () => spoken.at(-1)?.onerror?.({} as SpeechSynthesisErrorEvent),
  }
  return {
    fake,
    said: () => spoken.map((utterance) => utterance.text),
    last: () => spoken.at(-1),
    end: () => spoken.at(-1)?.onend?.({} as SpeechSynthesisEvent),
  }
}

const utter = (text: string) => ({ text }) as SpeechSynthesisUtterance

describe('frenchVoice', () => {
  it('is a French voice of the machine, never another language', () => {
    expect(frenchVoice([ZIRA, HORTENSE])).toBe(HORTENSE)
  })

  it('is none on a machine without a French voice', () => {
    expect(frenchVoice([ZIRA])).toBeNull()
    expect(frenchVoice([])).toBeNull()
  })

  it('is one that speaks with no network before one fetched from a server', () => {
    const online = voice('Google français', 'fr-FR', false)

    expect(frenchVoice([online, HORTENSE])).toBe(HORTENSE)
    expect(frenchVoice([online])).toBe(online)
  })

  it("is France's before another country's, whatever the way the browser writes the language", () => {
    const canadian = voice('Microsoft Caroline', 'fr-CA')
    const android = voice('français France', 'fr_FR')

    expect(frenchVoice([canadian, HORTENSE])).toBe(HORTENSE)
    expect(frenchVoice([canadian, android])).toBe(android)
    expect(frenchVoice([voice('Filipino', 'fil-PH')])).toBeNull()
  })
})

describe('the speaker', () => {
  it('says a sentence with the French voice', () => {
    const browser = synthesis([ZIRA, HORTENSE])

    createSpeaker(browser.fake, utter).say(['Statut critique.'])

    expect(browser.said()).toEqual(['Statut critique.'])
    expect(browser.last()?.voice).toBe(HORTENSE)
    expect(browser.last()?.lang).toBe('fr-FR')
  })

  it('says the sentences one after the other, in their order', () => {
    const browser = synthesis([HORTENSE])
    const speaker = createSpeaker(browser.fake, utter)

    speaker.say(['a', 'b'])
    expect(browser.said()).toEqual(['a'])
    browser.end()
    speaker.say(['c'])
    expect(browser.said()).toEqual(['a', 'b'])
    browser.end()
    browser.end()

    expect(browser.said()).toEqual(['a', 'b', 'c'])
  })

  it('does not go on for a minute after a burst of Alerts', () => {
    const browser = synthesis([HORTENSE])
    const speaker = createSpeaker(browser.fake, utter)

    for (let index = 0; index < 40; index++) speaker.say([`alert ${index}`])
    for (let index = 0; index < 40; index++) browser.end()

    // The one it was on, then those the queue kept.
    expect(browser.said()).toHaveLength(1 + QUEUE_LIMIT)
    expect(browser.said().at(-1)).toBe('alert 39')
  })

  it('says nothing, and breaks nothing, without a French voice', () => {
    const browser = synthesis([ZIRA])
    const speaker = createSpeaker(browser.fake, utter)

    expect(() => speaker.say(['a', 'b'])).not.toThrow()
    expect(browser.said()).toEqual([])
  })

  it('does not say later what waited while the machine had no French voice', () => {
    const voices: SpeechSynthesisVoice[] = []
    const browser = synthesis(voices)
    const speaker = createSpeaker(browser.fake, utter)

    speaker.say(['stale'])
    voices.push(HORTENSE)
    speaker.say(['fresh'])

    expect(browser.said()).toEqual(['fresh'])
  })

  it('says nothing, and breaks nothing, in a browser without speech synthesis', () => {
    const speaker = createSpeaker(undefined, utter)

    expect(() => speaker.say(['a'])).not.toThrow()
    expect(() => speaker.hush()).not.toThrow()
  })

  it('goes on to the next sentence when the browser refuses one', () => {
    const browser = synthesis([HORTENSE])

    createSpeaker(browser.fake, utter).say(['a', 'b'])
    browser.last()?.onerror?.({} as SpeechSynthesisErrorEvent)

    expect(browser.said()).toEqual(['a', 'b'])
  })

  it('stops and forgets what was waiting when hushed, and speaks again when asked', () => {
    const browser = synthesis([HORTENSE])
    const speaker = createSpeaker(browser.fake, utter)

    speaker.say(['a', 'b'])
    speaker.hush()
    expect(browser.said()).toEqual(['a'])

    speaker.say(['c'])
    expect(browser.said()).toEqual(['a', 'c'])
  })
})

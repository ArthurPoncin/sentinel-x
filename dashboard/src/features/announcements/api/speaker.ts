import { queued } from '../utils/queue'

// What is asked of the browser's speech synthesis, and no more: a test gives its own.
export type Synthesis = Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel'>

type Voice = Pick<SpeechSynthesisVoice, 'lang' | 'localService'>

// The voice that says the announcements: a French one of this machine, which speaks with no network, France's
// before another country's. One the browser fetches from a server only when there is no other: on the
// demonstration's Wi-Fi it stays silent. None when the machine has no French voice at all.
export function frenchVoice<V extends Voice>(voices: readonly V[]): V | null {
  const french = voices.filter((voice) => /^fr([-_]|$)/i.test(voice.lang))
  const rank = (voice: V) => (voice.localService ? 2 : 0) + (/^fr[-_]FR$/i.test(voice.lang) ? 1 : 0)
  return french.toSorted((a, b) => rank(b) - rank(a))[0] ?? null
}

export interface Speaker {
  // Says these sentences in turn, after those it is already saying. A burst is cut to the queue's limit; what
  // the Operator asked for, a report, is said `whole`.
  say(phrases: readonly string[], whole?: boolean): void
  // Stops talking, in the middle of a sentence, and forgets what was waiting.
  hush(): void
}

// The built-in voice, over the browser's speech synthesis. One sentence at a time is handed to the browser:
// those waiting stay here, where a burst cannot pile them up. Without a French voice, or without synthesis
// at all, nothing is said and nothing waits. `told` hears when it starts talking and when it is done: the
// ear is closed meanwhile.
export function createSpeaker(
  synthesis: Synthesis | undefined,
  utter: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text),
  told: (talking: boolean) => void = () => {},
): Speaker {
  let waiting: string[] = []
  // The sentence the browser is on. Held here: a browser may forget one nobody holds, and never end it.
  let current: SpeechSynthesisUtterance | null = null
  let talking = false
  // Asked for early: a browser that loads its voices late has them by the first Alert.
  synthesis?.getVoices()

  const tell = (next: boolean) => {
    if (next === talking) return
    talking = next
    told(next)
  }

  const next = () => {
    const voice = synthesis && frenchVoice(synthesis.getVoices())
    const phrase = voice ? waiting.shift() : undefined
    if (!synthesis || !voice || phrase === undefined) {
      waiting = []
      current = null
      return tell(false)
    }
    const utterance = utter(phrase)
    current = utterance
    utterance.voice = voice
    utterance.lang = voice.lang
    // A sentence the browser refused or cut short ends too: the next one has its turn. Not for one that was
    // hushed: the browser ends it late, once another may be on its way.
    utterance.onend = utterance.onerror = () => {
      if (current === utterance) next()
    }
    tell(true)
    synthesis.speak(utterance)
  }

  return {
    say(phrases, whole = false) {
      waiting = whole ? [...waiting, ...phrases] : queued(waiting, phrases)
      if (!current) next()
    },
    hush() {
      waiting = []
      current = null
      synthesis?.cancel()
      tell(false)
    },
  }
}

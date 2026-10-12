// What the engine heard: a sentence, and how sure it is of it, from 0 to 1.
export interface Heard {
  text: string
  confidence: number
}

// Until when a command is taken, in seconds on a clock that only goes forward.
export interface Wake {
  until: number
}

export const ASLEEP: Wake = { until: -Infinity }

// The word a command starts with: the French one, a closed grammar only knows the words of its model.
export const WAKE_WORD = 'sentinelle'

export type Command = 'siren' | 'siren-off'

// Each command, by each way of asking for it.
export const WORDINGS: Readonly<Record<Command, readonly string[]>> = {
  siren: ['déclenche la sirène', 'lance la sirène', 'active la sirène'],
  'siren-off': ['coupe la sirène', 'arrête la sirène', 'stoppe la sirène'],
}

// Seconds after the wake word during which a command is taken: the time to say one, and for the engine to be
// done with it.
export const WAKE_WINDOW = 6

// What the engine gives for a word that is not in its grammar.
export const UNKNOWN = '[unk]'

// All the engine may hear, a closed grammar: the wake word, each wording, and anything else as unknown.
export const GRAMMAR: readonly string[] = [WAKE_WORD, ...Object.values(WORDINGS).flat(), UNKNOWN]

// Below this confidence a sentence does nothing. A starting point, to be set on the demo machine in the
// room's noise: lower, the Operator repeats less; higher, a conversation nearby sets nothing off.
export const THRESHOLD = 0.7

// What was made of a sentence: nothing, asleep; the wake word; a command; awake, words that are none; or a
// wake word or a command the engine was not sure enough of.
export type Outcome =
  | { kind: 'ignored' }
  | { kind: 'woken' }
  | { kind: 'unknown' }
  | { kind: 'unsure' }
  | { kind: 'command'; command: Command }

export interface Interpreted {
  wake: Wake
  outcome: Outcome
}

// The words between the noises a sentence starts and ends with. A word the engine did not know among them
// stays: it may be the « ne … pas » that turns the command around.
function between(words: readonly string[]): readonly string[] {
  const first = words.findIndex((word) => word !== UNKNOWN)
  return first === -1 ? [] : words.slice(first, words.findLastIndex((word) => word !== UNKNOWN) + 1)
}

function commandOf(words: readonly string[]): Command | null {
  const sentence = words.join(' ')
  for (const command of Object.keys(WORDINGS) as Command[]) if (WORDINGS[command].includes(sentence)) return command
  return null
}

// What the words say, whatever the engine's doubts.
function understand(wake: Wake, heard: Heard, now: number): Interpreted {
  const words = heard.text.split(/\s+/).filter(Boolean)
  const called = words.lastIndexOf(WAKE_WORD)
  if (called === -1 && now > wake.until) return { wake: ASLEEP, outcome: { kind: 'ignored' } }
  // What is asked for comes after the wake word, or is the whole sentence that follows it.
  const asked = words.slice(called + 1)
  const command = commandOf(between(asked))
  // One wake word, one command.
  if (command) return { wake: ASLEEP, outcome: { kind: 'command', command } }
  if (called !== -1) {
    const woken = { until: now + WAKE_WINDOW }
    return { wake: woken, outcome: { kind: asked.length === 0 ? 'woken' : 'unknown' } }
  }
  // Awake, and what was said is no command: the window stays as it was, to say it again.
  return { wake, outcome: { kind: asked.length === 0 ? 'ignored' : 'unknown' } }
}

// What a sentence the engine heard asks for, `now` in seconds: a command only after the wake word, in the
// same sentence or within the wake window, and only when the engine is sure of it; a wake word it is not
// sure of opens no window either, whatever follows it. Pure: it knows neither the microphone nor the engine.
export function interpret(wake: Wake, heard: Heard, now: number): Interpreted {
  const understood = understand(wake, heard, now)
  const acted = understood.outcome.kind === 'command' || understood.wake.until > wake.until
  if (!acted || heard.confidence >= THRESHOLD) return understood
  // Nothing is done, and nothing is lost: what was open stays open, to say it again.
  return { wake: now > wake.until ? ASLEEP : wake, outcome: { kind: 'unsure' } }
}

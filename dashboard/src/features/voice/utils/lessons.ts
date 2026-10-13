import { type Command, type Outcome, ofWindows, WAKE_WINDOW, WAKE_WORD, WINDOW_NAMES, WORDINGS } from './interpret'
import { asks } from './lines'

// What the tutorial teaches: the wake word by itself, then each command of the vocabulary.
export type LessonId = 'wake' | Command

export interface Lesson {
  id: LessonId
  title: string
  // Each way of saying it, as the engine hears it.
  wordings: readonly string[]
  // What the dashboard does about it, out of the tutorial.
  does: string
}

// The lessons that go together, under one heading.
export interface Chapter {
  title: string
  // How to say what is in it, when that takes a word.
  how?: string
  lessons: readonly Lesson[]
}

// What each command does, in the Operator's words.
const DOES: Readonly<Record<Command, string>> = {
  siren: 'La sirène du Sentinel sonne.',
  'siren-off': 'La sirène du Sentinel se tait.',
  operator: "Le dashboard passe à l'écran opérateur.",
  twin: 'Le dashboard passe au jumeau numérique.',
  tutorial: 'Le dashboard passe au tutoriel des gestes.',
  'voice-tutorial': 'Le dashboard passe à cet écran.',
  'replay-last': 'Le dernier incident clos est rejoué sur le jumeau numérique.',
  report: "L'état du site et les alertes actives sont dits, la plus grave d'abord.",
  silence: 'Les annonces ne sont plus dites. Elles restent écrites.',
  speak: 'Les annonces sont dites à nouveau.',
  ...ofWindows((verb, window) =>
    verb === 'show'
      ? `Ouvre la fenêtre « ${WINDOW_NAMES[window]} » du jumeau numérique, depuis n'importe quel écran.`
      : `Ferme la fenêtre « ${WINDOW_NAMES[window]} », sur le jumeau numérique.`,
  ),
  'close-all': 'Ferme toutes les fenêtres ouvertes sur le jumeau numérique.',
}

const capitalized = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

function lessonOf(command: Command): Lesson {
  return { id: command, title: capitalized(asks(command)), wordings: WORDINGS[command], does: DOES[command] }
}

// The wake word by itself, before any command: nothing is taken without it.
const WAKE: Lesson = {
  id: 'wake',
  title: "Le mot d'éveil",
  wordings: [WAKE_WORD],
  does: `Éveille l'écoute pendant ${WAKE_WINDOW} secondes. Dites-le seul, puis attendez : la barre du haut passe à « Éveillée ».`,
}

const WINDOWS = Object.keys(WINDOW_NAMES) as (keyof typeof WINDOW_NAMES)[]

// The tutorial, in the order it is shown: the wake word first, then the vocabulary by what it is about.
export const CHAPTERS: readonly Chapter[] = [
  { title: "Le mot d'éveil", lessons: [WAKE] },
  { title: 'La sirène', lessons: [lessonOf('siren'), lessonOf('siren-off')] },
  {
    title: 'Les écrans',
    how: "Le nom d'un écran suffit.",
    lessons: [lessonOf('operator'), lessonOf('twin'), lessonOf('tutorial'), lessonOf('voice-tutorial')],
  },
  { title: 'Le site', lessons: [lessonOf('report'), lessonOf('replay-last')] },
  { title: 'Les annonces', lessons: [lessonOf('silence'), lessonOf('speak')] },
  {
    title: 'Les fenêtres du jumeau numérique',
    how: 'Un verbe, puis le nom de la fenêtre.',
    lessons: [
      ...WINDOWS.map((window) => lessonOf(`show-${window}`)),
      ...WINDOWS.map((window) => lessonOf(`close-${window}`)),
      lessonOf('close-all'),
    ],
  },
]

export const LESSONS: readonly Lesson[] = CHAPTERS.flatMap(({ lessons }) => lessons)

// The lessons a sentence completes, by what was made of it: the wake word said by itself, or a command. One
// the engine doubted, did not know, or that came without the wake word completes none.
export function completed(outcome: Outcome): readonly LessonId[] {
  if (outcome.kind === 'woken') return ['wake']
  return outcome.kind === 'command' ? [outcome.command] : []
}

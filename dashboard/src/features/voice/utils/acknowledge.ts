import { type Command, ofWindows, WINDOW_NAMES } from './interpret'

// What the voice answers to: a command it carried out, or what kept it from one. Words that were no command,
// a command it was not sure of, one only tried in the gestures' tutorial, one tried in its own, a screen the app
// is on already, a window closed where none is open, no Incident to replay or none to be had, and an Alarm the
// Command Post did not relay.
export type Reply =
  | Command
  | 'unknown'
  | 'unsure'
  | 'only-tried'
  | 'tried'
  | 'already-there'
  | 'no-window'
  | 'nothing-to-replay'
  | 'incidents-unreachable'
  | 'alarm-failed'

// The few sentences that acknowledge each, said and written: short, in the tone of an assistant on board, with
// no name and no line taken from a film.
export const ACKNOWLEDGEMENTS: Readonly<Record<Reply, readonly [string, ...string[]]>> = {
  siren: ['Sirène déclenchée.', 'Alarme lancée.', "C'est fait, la sirène sonne."],
  'siren-off': ['Sirène coupée.', 'Alarme arrêtée.', "C'est fait, la sirène se tait."],
  operator: ['Écran opérateur.', "Voici l'écran opérateur."],
  twin: ['Jumeau numérique.', 'Voici le jumeau numérique.'],
  tutorial: ['Tutoriel des gestes.', 'Voici le tutoriel des gestes.'],
  'voice-tutorial': ['Tutoriel de la voix.', 'Voici le tutoriel de la voix.'],
  'replay-last': ['Je rejoue le dernier incident.', 'Dernier incident, sur le jumeau.'],
  report: ['Rapport.', 'Voici le rapport.', 'État du site.'],
  silence: ['Annonces coupées.', 'Entendu, je me tais.'],
  speak: ['Annonces rétablies.', 'Entendu, je reprends les annonces.'],
  ...ofWindows((verb, window): [string, ...string[]] =>
    verb === 'show'
      ? [`Voici ${WINDOW_NAMES[window]}.`, `J'affiche ${WINDOW_NAMES[window]}.`]
      : [`Je ferme ${WINDOW_NAMES[window]}.`, 'Fenêtre fermée.'],
  ),
  'close-all': ['Tout est fermé.', 'Je ferme toutes les fenêtres.'],
  unknown: ["Je n'ai pas compris.", 'Commande inconnue.'],
  unsure: ['Je ne suis pas sûre, répétez.', 'Pouvez-vous répéter ?'],
  'only-tried': ['Dans le tutoriel, la commande est seulement essayée.'],
  // In the voice's own tutorial, where each command is a lesson: short, another one follows.
  tried: ['Réussi.', 'Commande reconnue.', "C'est bien ça."],
  'no-window': ["Aucune fenêtre n'est ouverte ici."],
  'already-there': ['Vous y êtes déjà.', 'Cet écran est déjà affiché.'],
  'nothing-to-replay': ['Aucun incident à rejouer.'],
  'incidents-unreachable': ['Les incidents sont injoignables.'],
  'alarm-failed': ["La sirène n'a pas reçu la commande.", "La commande n'est pas passée."],
}

// The sentence that acknowledges `reply`, one of its few: `draw` is in [0, 1), a throw of the dice unless a
// test says otherwise.
export function acknowledge(reply: Reply, draw: () => number = Math.random): string {
  const sentences = ACKNOWLEDGEMENTS[reply]
  return sentences[Math.floor(draw() * sentences.length)] ?? sentences[0]
}

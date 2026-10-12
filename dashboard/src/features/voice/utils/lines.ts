import type { Failure } from '../api/ear'
import type { VoiceState } from '../stores/voice-store'
import { type Command, type Outcome, ofWindows, UNKNOWN, WINDOW_NAMES } from './interpret'

// Where the ear is, in the Operator's words.
const STATUS: Readonly<Record<Exclude<VoiceState['status'], 'off'>, string>> = {
  // One ear for the whole browser: two would send each command twice.
  waiting: "Commande vocale · à l'écoute dans un autre onglet",
  asking: 'Commande vocale · autorisez le micro',
  // Some tens of megabytes the first time, from the browser's cache after that.
  loading: 'Chargement du modèle vocal…',
  listening: "À l'écoute · dites « Sentinelle »",
  awake: 'Éveillée · dites la commande',
}

export function statusLine(status: Exclude<VoiceState['status'], 'off'>): string {
  return STATUS[status]
}

// What a command asks for, in the Operator's words.
const COMMANDS: Readonly<Record<Command, string>> = {
  siren: 'déclencher la sirène',
  'siren-off': 'couper la sirène',
  operator: "aller à l'écran opérateur",
  twin: 'aller au jumeau numérique',
  tutorial: 'aller au tutoriel des gestes',
  'replay-last': 'rejouer le dernier incident',
  report: 'faire le rapport',
  silence: 'faire taire les annonces',
  speak: 'rétablir les annonces',
  ...ofWindows((verb, window) => `${verb === 'show' ? 'afficher' : 'fermer'} ${WINDOW_NAMES[window]}`),
  'close-all': 'fermer toutes les fenêtres',
}

function made(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'command':
      return `commande : ${COMMANDS[outcome.command]}`
    case 'woken':
      return "mot d'éveil entendu"
    case 'ignored':
      return "sans « Sentinelle », rien n'est fait"
    case 'unknown':
      return 'pas compris'
    case 'unsure':
      return 'pas assez sûr, répétez'
  }
}

// The last sentence heard with what was made of it: a word the engine did not know is a gap in it.
export function lastLine({ text, outcome }: NonNullable<VoiceState['last']>): string {
  return `« ${text.replaceAll(UNKNOWN, '…')} » · ${made(outcome)}`
}

// Why the voice control went back to off, in the Operator's words.
export function failureLine(failure: Failure): string {
  switch (failure) {
    case 'refused':
      return 'Le micro a été refusé : autorisez-le pour ce site dans le navigateur, puis réactivez la commande vocale.'
    case 'no-microphone':
      return 'Aucun micro trouvé sur ce poste.'
    case 'unavailable':
      return "Le micro ne répond pas : débranché, ou pris par une autre application. Réactivez la commande vocale une fois qu'il est libre."
    case 'blocked':
      return "Le navigateur n'a pas ouvert le son sans un geste sur la page : réactivez la commande vocale."
    case 'unsupported':
      return 'Ce navigateur ne donne pas accès au micro ici : la commande vocale demande une page en HTTPS.'
    case 'model':
      return "Le modèle vocal n'a pas pu être chargé depuis le dashboard."
  }
}

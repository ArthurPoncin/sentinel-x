import { describe, expect, it } from 'vitest'
import { failureLine, lastLine, statusLine } from './lines'

describe('statusLine', () => {
  it('says where the ear is, from the microphone to the wake word', () => {
    expect(statusLine('waiting')).toMatch(/dans un autre onglet/)
    expect(statusLine('asking')).toMatch(/autorisez le micro/)
    expect(statusLine('loading')).toMatch(/Chargement du modèle vocal/)
    expect(statusLine('listening')).toMatch(/À l'écoute · dites « Sentinelle »/)
    expect(statusLine('awake')).toMatch(/Éveillée · dites la commande/)
  })
})

describe('lastLine', () => {
  it('shows the last sentence with what was made of it', () => {
    const line = (text: string, outcome: Parameters<typeof lastLine>[0]['outcome']) => lastLine({ text, outcome })

    expect(line('sentinelle coupe la sirène', { kind: 'command', command: 'siren-off' })).toBe(
      '« sentinelle coupe la sirène » · commande : couper la sirène',
    )
    expect(line('sentinelle lance la sirène', { kind: 'command', command: 'siren' })).toBe(
      '« sentinelle lance la sirène » · commande : déclencher la sirène',
    )
    expect(line('sentinelle jumeau', { kind: 'command', command: 'twin' })).toBe(
      '« sentinelle jumeau » · commande : aller au jumeau numérique',
    )
    expect(line('sentinelle opérateur', { kind: 'command', command: 'operator' })).toBe(
      "« sentinelle opérateur » · commande : aller à l'écran opérateur",
    )
    expect(line('sentinelle gestes', { kind: 'command', command: 'tutorial' })).toBe(
      '« sentinelle gestes » · commande : aller au tutoriel des gestes',
    )
    expect(line('sentinelle tutoriel vocal', { kind: 'command', command: 'voice-tutorial' })).toBe(
      '« sentinelle tutoriel vocal » · commande : aller au tutoriel de la voix',
    )
    expect(line('sentinelle rejoue le dernier incident', { kind: 'command', command: 'replay-last' })).toBe(
      '« sentinelle rejoue le dernier incident » · commande : rejouer le dernier incident',
    )
    expect(line('sentinelle rapport', { kind: 'command', command: 'report' })).toBe('« sentinelle rapport » · commande : faire le rapport')
    expect(line('sentinelle silence', { kind: 'command', command: 'silence' })).toBe(
      '« sentinelle silence » · commande : faire taire les annonces',
    )
    expect(line('sentinelle parle', { kind: 'command', command: 'speak' })).toBe('« sentinelle parle » · commande : rétablir les annonces')
    expect(line('sentinelle affiche la caméra', { kind: 'command', command: 'show-camera' })).toBe(
      '« sentinelle affiche la caméra » · commande : afficher la caméra',
    )
    expect(line('sentinelle ferme les alertes', { kind: 'command', command: 'close-alerts' })).toBe(
      '« sentinelle ferme les alertes » · commande : fermer les alertes',
    )
    expect(line('sentinelle ferme tout', { kind: 'command', command: 'close-all' })).toBe(
      '« sentinelle ferme tout » · commande : fermer toutes les fenêtres',
    )
    expect(line('sentinelle', { kind: 'woken' })).toBe('« sentinelle » · mot d\'éveil entendu')
    expect(line('coupe la sirène', { kind: 'ignored' })).toBe('« coupe la sirène » · sans « Sentinelle », rien n\'est fait')
    expect(line('sentinelle coupe la sirène', { kind: 'unsure' })).toBe(
      '« sentinelle coupe la sirène » · pas assez sûr, répétez',
    )
  })

  it('shows a word it did not know as a gap, and says it did not understand', () => {
    expect(lastLine({ text: 'sentinelle affiche [unk]', outcome: { kind: 'unknown' } })).toBe(
      '« sentinelle affiche … » · pas compris',
    )
    expect(lastLine({ text: 'sentinelle [unk] la sirène', outcome: { kind: 'unknown' } })).toBe(
      '« sentinelle … la sirène » · pas compris',
    )
  })
})

describe('failureLine', () => {
  it('says why the voice control went back to off', () => {
    expect(failureLine('refused')).toMatch(/micro a été refusé/)
    expect(failureLine('no-microphone')).toMatch(/Aucun micro/)
    expect(failureLine('unavailable')).toMatch(/micro ne répond pas/)
    expect(failureLine('blocked')).toMatch(/sans un geste/)
    expect(failureLine('unsupported')).toMatch(/navigateur/)
    expect(failureLine('model')).toMatch(/modèle vocal/)
  })
})

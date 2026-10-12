import { describe, expect, it } from 'vitest'
import { failureLine, lastLine, statusLine } from './lines'

describe('statusLine', () => {
  it('says where the ear is, from the microphone to the wake word', () => {
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
    expect(line('sentinelle', { kind: 'woken' })).toBe('« sentinelle » · mot d\'éveil entendu')
    expect(line('coupe la sirène', { kind: 'ignored' })).toBe('« coupe la sirène » · sans « Sentinelle », rien n\'est fait')
    expect(line('sentinelle coupe la sirène', { kind: 'unsure' })).toBe(
      '« sentinelle coupe la sirène » · pas assez sûr, répétez',
    )
  })

  it('shows a word it did not know as a gap, and says it did not understand', () => {
    expect(lastLine({ text: 'sentinelle [unk] la sirène', outcome: { kind: 'unknown' } })).toBe(
      '« sentinelle … la sirène » · pas compris',
    )
  })
})

describe('failureLine', () => {
  it('says why the voice control went back to off', () => {
    expect(failureLine('refused')).toMatch(/micro a été refusé/)
    expect(failureLine('no-microphone')).toMatch(/Aucun micro/)
    expect(failureLine('unsupported')).toMatch(/navigateur/)
    expect(failureLine('model')).toMatch(/modèle vocal/)
  })
})

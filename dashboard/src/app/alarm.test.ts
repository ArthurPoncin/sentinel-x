import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveAlarm, presetOfGesture, presetOfVoice } from './alarm'
import { TUTORIAL } from './app-sidebar'

// The Command Post API, answering every command with `status`: what it was sent is kept.
function commandPost(status = 202) {
  const sent: { path: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    sent.push({ path, body })
    return new Response(JSON.stringify({ cmd_id: 'c-1', ...body, ts: '2026-10-12T10:00:00.000Z' }), { status })
  })
  return sent
}

afterEach(() => vi.unstubAllGlobals())

describe('a voice command for the Alarm', () => {
  it('sends what the gesture sends', async () => {
    const sent = commandPost()

    await driveAlarm('sentinel-01', presetOfGesture('all-clear', '/')!, 'hand')
    await driveAlarm('sentinel-01', presetOfVoice('siren-off', '/')!, 'voice')
    await driveAlarm('sentinel-01', presetOfGesture('alarm', '/twin')!, 'hand')
    await driveAlarm('sentinel-01', presetOfVoice('siren', '/twin')!, 'voice')

    expect(sent).toHaveLength(4)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[3]).toEqual(sent[2])
    expect(sent[1]).toEqual({ path: '/api/v1/commands', body: { sentinel: 'sentinel-01', actuator: 'buzzer', action: 'off' } })
  })

  it('answers with the same toast, which says it came by the voice', async () => {
    commandPost()

    const byHand = await driveAlarm('sentinel-01', 'siren-off', 'hand')
    const byVoice = await driveAlarm('sentinel-01', 'siren-off', 'voice')

    expect(byHand).toEqual({ success: true, title: 'Couper la sirène', description: 'Geste reconnu · commande transmise à sentinel-01' })
    expect(byVoice).toEqual({ success: true, title: 'Couper la sirène', description: 'Commande vocale · commande transmise à sentinel-01' })
  })

  it('answers with the same error when the relay fails', async () => {
    commandPost(503)

    const byHand = await driveAlarm('sentinel-01', 'siren', 'hand')
    const byVoice = await driveAlarm('sentinel-01', 'siren', 'voice')

    expect(byVoice).toEqual(byHand)
    expect(byVoice).toEqual({
      success: false,
      title: 'Commande non transmise',
      description: "Le broker est injoignable : la commande n'a pas atteint le Sentinel.",
    })
  })

  it('sends nothing in the tutorial, where a command is only tried', () => {
    expect(presetOfVoice('siren', TUTORIAL)).toBeNull()
    expect(presetOfVoice('siren-off', `${TUTORIAL}/`)).toBeNull()
    expect(presetOfGesture('alarm', TUTORIAL)).toBeNull()
  })

  it('has no preset for a gesture that is not about the Alarm', () => {
    expect(presetOfGesture('page-left', '/')).toBeNull()
  })
})

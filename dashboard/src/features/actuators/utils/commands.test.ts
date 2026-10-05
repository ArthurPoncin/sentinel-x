import { describe, expect, it } from 'vitest'
import { CommandRequestSchema } from '@/shared/contract'
import { buildCommand, commandFailure, type Preset, PRESETS } from './commands'

const siren = PRESETS.find((preset) => preset.id === 'siren') as Preset

describe('buildCommand', () => {
  it('builds a command the contract accepts for every preset', () => {
    for (const preset of PRESETS) {
      const built = buildCommand('sentinel-01', preset)

      expect(built.success).toBe(true)
      if (built.success) expect(CommandRequestSchema.parse(built.request)).toEqual(built.request)
    }
  })

  it('addresses the command to the Sentinel', () => {
    const built = buildCommand('sentinel-01', siren)

    expect(built).toEqual({
      success: true,
      request: { sentinel: 'sentinel-01', actuator: 'buzzer', action: 'pattern', params: { pattern: 'siren' } },
    })
  })

  it('sends nothing before a Sentinel is known', () => {
    expect(buildCommand(null, siren)).toEqual({ success: false, reason: 'No Sentinel heard from yet' })
  })

  it('sends nothing to a Sentinel id the topic could not carry', () => {
    expect(buildCommand('sentinel/+/#', siren).success).toBe(false)
  })
})

describe('commandFailure', () => {
  it('explains the refusals the API gives', () => {
    expect(commandFailure(401)).toMatch(/session expired/)
    expect(commandFailure(429)).toMatch(/Too fast/)
    expect(commandFailure(503)).toMatch(/broker/)
  })
})

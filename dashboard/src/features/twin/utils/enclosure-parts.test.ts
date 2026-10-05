import { describe, expect, it } from 'vitest'
import { ENCLOSURE_PARTS } from './enclosure-parts'

describe('Enclosure parts', () => {
  it('names every Probe and every actuator, for the later slices to drive', () => {
    expect(Object.keys(ENCLOSURE_PARTS)).toEqual(
      expect.arrayContaining(['dht22', 'mq2', 'pir', 'mic', 'ledRing', 'buzzer']),
    )
  })

  it('gives each part a name of its own in the scene', () => {
    const names = Object.values(ENCLOSURE_PARTS)

    expect(new Set(names).size).toBe(names.length)
  })
})

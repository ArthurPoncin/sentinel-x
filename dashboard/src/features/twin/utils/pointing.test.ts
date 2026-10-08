import { describe, expect, it } from 'vitest'
import { STATUS_COLORS } from '@/shared/config/status-colors'
import { CRITICAL_AIR } from './gas-level'
import { CALM_CARD, cardFor, type Intel, personCard, pointedAt, type Sighted, SPOTS, spotCard, throughSpot } from './pointing'
import { SITE } from './site'

const readings = { temp: 22.4, humidity: 41, air: 180, pir: false, sound: 0.2 }
const intel = (over: Partial<Intel> = {}): Intel => ({
  readings,
  intruder: null,
  link: { encrypted: true },
  signalLost: false,
  thermal: { intensity: 0, shimmer: false },
  status: { level: 'nominal' },
  ...over,
})
const person = (over: Partial<Sighted> = {}): Sighted => ({ id: 'a1/3', key: '3', at: { x: 2, z: -1 }, followed: true, age: 4.6, ...over })
const intruder = {
  alertId: 'a1',
  key: '3',
  x_norm: 0.5,
  confidence: 0.88,
  label: 'PERSONNE · 88 %',
  at: { x: 2, z: -1 },
  others: [{ key: '7', at: { x: 0, z: 2 }, x_norm: 0.1, confidence: 0.61 }],
}
const tank = SPOTS.find(({ id }) => id === 'gas')
if (!tank) throw new Error('no gas tank')

describe('throughSpot', () => {
  it('is on a part the sight looks through, and says how far', () => {
    expect(throughSpot([tank.at[0], tank.at[1], tank.at[2] + 5], [0, 0, -1], tank)).toBeCloseTo(5)
  })

  it('is on it up to its edge, and not past it', () => {
    expect(throughSpot([tank.at[0] + tank.radius * 0.9, tank.at[1], 5], [0, 0, -1], tank)).not.toBeNull()
    expect(throughSpot([tank.at[0] + tank.radius * 1.1, tank.at[1], 5], [0, 0, -1], tank)).toBeNull()
  })

  it('is on nothing that is behind', () => {
    expect(throughSpot([tank.at[0], tank.at[1], tank.at[2] + 5], [0, 0, 1], tank)).toBeNull()
  })
})

describe('pointedAt', () => {
  it('is on nothing over empty ground', () => {
    expect(pointedAt([-2.5, 5, 2.5], [0, -1, 0], [])).toBeNull()
  })

  it('is on the part of the site the sight looks through', () => {
    expect(pointedAt([SITE.tank.x, 5, SITE.tank.z], [0, -1, 0], [])).toMatchObject({ kind: 'spot', id: 'gas' })
    expect(pointedAt([SITE.hall.x, 5, SITE.hall.z], [0, -1, 0], [])).toMatchObject({ kind: 'spot', id: 'hall' })
    expect(pointedAt([SITE.enclosure.x, 2.2, 5], [0, 0, -1], [])).toMatchObject({ kind: 'spot', id: 'enclosure' })
  })

  it('is on someone before the part they stand in front of, and on whoever is nearest', () => {
    const inFront = person({ at: { x: SITE.hall.x, z: SITE.hall.z + 1 } })
    const behind = person({ id: 'a1/7', key: '7', at: { x: SITE.hall.x, z: SITE.hall.z + 0.2 } })

    expect(pointedAt([SITE.hall.x, 0.2, 6], [0, 0, -1], [behind, inFront])).toMatchObject({ kind: 'person', person: inFront })
  })
})

describe('spotCard', () => {
  it('reads the gas Probe on the tank, calm in the sight\'s own color', () => {
    expect(spotCard('gas', intel())).toEqual({ title: 'CUVE DE GAZ · MQ-2', lines: ['Gaz : 180', 'Niveau : calme'], color: CALM_CARD })
  })

  it('says a gas that is critical, in the critical color', () => {
    const card = spotCard('gas', intel({ readings: { ...readings, air: CRITICAL_AIR } }))

    expect(card.lines).toContain('Niveau : critique')
    expect(card.color).toBe(STATUS_COLORS.critical)
  })

  it('reads the temperature and the humidity on the hall', () => {
    expect(spotCard('hall', intel()).lines).toEqual(['Température : 22.4 °C', 'Humidité : 41 %', 'Chaleur : calme'])
  })

  it('says the Status, the link and what the Enclosure senses, in the Status\'s color', () => {
    const card = spotCard('enclosure', intel({ status: { level: 'elevated' } }))

    expect(card.lines).toEqual(['Statut : ELEVATED', 'Liaison : chiffrée (WSS)', 'Présence PIR : non', 'Bruit : 20 %'])
    expect(card.color).toBe(STATUS_COLORS.elevated)
    expect(spotCard('enclosure', intel({ link: { encrypted: false } })).lines).toContain('Liaison : en clair')
    expect(spotCard('enclosure', intel({ signalLost: true })).lines).toContain('Liaison : signal perdu')
  })

  it('makes up no reading before any is received', () => {
    for (const id of ['gas', 'hall', 'enclosure'] as const) {
      expect(spotCard(id, intel({ readings: null })).lines).toContain('aucune mesure reçue')
    }
  })
})

describe('personCard', () => {
  it('tells what the vision model tells of the one the camera follows', () => {
    expect(personCard(person(), intruder)).toEqual({
      title: 'CIBLE N° 3',
      lines: ['Personne · confiance 88 %', 'Position : au centre du champ', 'Suivie par la caméra', 'En vue depuis 4 s · 2 en vue'],
      color: STATUS_COLORS.critical,
    })
  })

  it('tells of another person in the image by what the Alert says of them', () => {
    const other = personCard(person({ id: 'a1/7', key: '7', followed: false }), intruder)

    expect(other.title).toBe('CIBLE N° 7')
    expect(other.lines).toContain('Personne · confiance 61 %')
    expect(other.lines).toContain('Position : à gauche du champ')
    expect(other.lines).toContain('Dans le champ, non suivie')
  })

  it('says nothing of who they are', () => {
    const words = [personCard(person(), intruder).title, ...personCard(person(), intruder).lines].join(' ')

    expect(words).not.toMatch(/âge|sexe|homme|femme|nom/i)
  })
})

describe('cardFor', () => {
  it('has no card for nothing, nor for someone the scene no longer tells of', () => {
    expect(cardFor(null, intel())).toBeNull()
    expect(cardFor({ kind: 'person', person: person(), reached: 1 }, intel())).toBeNull()
  })

  it('has the card of what the sight is on', () => {
    expect(cardFor({ kind: 'spot', id: 'gas', reached: 1 }, intel())?.title).toMatch(/GAZ/)
    expect(cardFor({ kind: 'person', person: person(), reached: 1 }, intel({ intruder }))?.title).toBe('CIBLE N° 3')
  })
})

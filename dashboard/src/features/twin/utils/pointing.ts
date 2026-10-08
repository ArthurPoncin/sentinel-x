import { STATUS_COLORS } from '@/shared/config/status-colors'
import { ENCLOSURE_SHAPE } from './enclosure-parts'
import { gasLevel } from './gas-level'
import { heatLevel } from './heat-level'
import type { SceneProps } from './scene'
import { hitAt, type Triple } from './shooting'
import { type GroundPoint, SITE } from './site'

// An Operator who points a finger at the Twin has a sight over it. What the sight is on says what the Outpost
// knows of it, on a card by the sight: a part of the site reads the Probe that watches it, an intruder what the
// vision model tells of them. Nothing is made up: a card holds what the feed carries, and no more.

// The parts of the site that have something to say, each a ball the sight is on when it looks through it.
export type SpotId = 'gas' | 'hall' | 'enclosure'

export interface Spot {
  id: SpotId
  at: Triple
  radius: number
}

const { tank, hall, enclosure } = SITE

// The gas tank, the generator hall, and the Enclosure's body on top of its mast, by where its lens is.
export const SPOTS: readonly Spot[] = [
  { id: 'gas', at: [tank.x, tank.height / 2, tank.z], radius: 0.5 },
  { id: 'hall', at: [hall.x, hall.height / 2, hall.z], radius: 0.8 },
  { id: 'enclosure', at: [enclosure.x, ENCLOSURE_SHAPE.lens.y * ENCLOSURE_SHAPE.scale, enclosure.z], radius: 0.75 },
]

// Someone the camera sees, as whoever draws their figurine tells it.
export interface Sighted {
  id: string
  // Who they are in their Alert.
  key: string
  at: GroundPoint
  followed: boolean
  // For how many seconds their figurine has been shown.
  age: number
}

// What the sight is on: someone, or a part of the site.
export type Pointed = { kind: 'person'; person: Sighted; reached: number } | { kind: 'spot'; id: SpotId; reached: number }

// How far along a line from `origin` toward `direction`, a unit vector, it is nearest the middle of `spot`,
// when it then goes through it. Null when it misses, or when the spot is behind.
export function throughSpot(origin: Triple, direction: Triple, spot: Spot): number | null {
  const to: Triple = [spot.at[0] - origin[0], spot.at[1] - origin[1], spot.at[2] - origin[2]]
  const reached = to[0] * direction[0] + to[1] * direction[1] + to[2] * direction[2]
  if (reached <= 0) return null
  const miss = Math.hypot(to[0] - reached * direction[0], to[1] - reached * direction[1], to[2] - reached * direction[2])
  return miss <= spot.radius ? reached : null
}

// What a sight that looks from `origin` toward `direction` is on: someone first, whoever is nearest, since a
// figurine is a small thing in front of large ones; then the nearest part of the site. Null on nothing.
export function pointedAt(origin: Triple, direction: Triple, people: readonly Sighted[], spots = SPOTS): Pointed | null {
  let nearest: Pointed | null = null
  for (const person of people) {
    const reached = hitAt(origin, direction, person.at)
    if (reached !== null && (nearest === null || reached < nearest.reached)) nearest = { kind: 'person', person, reached }
  }
  if (nearest) return nearest
  for (const spot of spots) {
    const reached = throughSpot(origin, direction, spot)
    if (reached !== null && (nearest === null || reached < nearest.reached)) nearest = { kind: 'spot', id: spot.id, reached }
  }
  return nearest
}

// What a card reads: a title, a few lines under it, and the color it is edged in.
export interface Card {
  title: string
  lines: readonly string[]
  color: string
}

// What the scene knows that a card may tell.
export type Intel = Pick<SceneProps, 'readings' | 'intruder' | 'link' | 'signalLost' | 'thermal'> & {
  status: Pick<SceneProps['status'], 'level'>
}

// The cold white of the sight: a part that has nothing wrong to tell.
export const CALM_CARD = '#9fdcff'
const NO_READING = 'aucune mesure reçue'

const percent = (share: number) => `${Math.round(Math.min(1, Math.max(0, share)) * 100)} %`
// How far a level is from calm, in the Status's words and colors.
function graded(level: number): { word: string; color: string } {
  if (level >= 1) return { word: 'critique', color: STATUS_COLORS.critical }
  if (level > 0) return { word: 'en hausse', color: STATUS_COLORS.elevated }
  return { word: 'calme', color: CALM_CARD }
}

// Where across the camera's image someone is, in words.
function across(xNorm: number): string {
  if (xNorm < 1 / 3) return 'à gauche du champ'
  if (xNorm > 2 / 3) return 'à droite du champ'
  return 'au centre du champ'
}

// The card of a part of the site, from what its Probe last read.
export function spotCard(id: SpotId, intel: Intel): Card {
  const { readings } = intel
  if (id === 'gas') {
    const grade = graded(gasLevel(readings?.air ?? null))
    return {
      title: 'CUVE DE GAZ · MQ-2',
      lines: readings ? [`Gaz : ${Math.round(readings.air)}`, `Niveau : ${grade.word}`] : [NO_READING],
      color: readings ? grade.color : CALM_CARD,
    }
  }
  if (id === 'hall') {
    const grade = graded(heatLevel(readings?.temp ?? null))
    return {
      title: 'HALL GÉNÉRATEUR · DHT22',
      lines: readings
        ? [`Température : ${readings.temp.toFixed(1)} °C`, `Humidité : ${Math.round(readings.humidity)} %`, `Chaleur : ${grade.word}`]
        : [NO_READING],
      color: readings ? grade.color : CALM_CARD,
    }
  }
  return {
    title: 'SENTINEL-X · BOÎTIER',
    lines: [
      `Statut : ${intel.status.level.toUpperCase()}`,
      intel.signalLost ? 'Liaison : signal perdu' : `Liaison : ${intel.link.encrypted ? 'chiffrée (WSS)' : 'en clair'}`,
      ...(readings ? [`Présence PIR : ${readings.pir ? 'oui' : 'non'}`, `Bruit : ${percent(readings.sound)}`] : [NO_READING]),
    ],
    color: STATUS_COLORS[intel.status.level],
  }
}

// The card of someone the camera sees: what the vision model tells of them, which is where they are and how
// sure it is that they are a person. Who they are, it does not know, and the card does not say.
export function personCard(person: Sighted, intruder: NonNullable<SceneProps['intruder']>): Card {
  const told = person.followed ? intruder : intruder.others.find(({ key }) => key === person.key)
  return {
    title: `CIBLE N° ${person.key}`,
    lines: [
      ...(told ? [`Personne · confiance ${percent(told.confidence)}`, `Position : ${across(told.x_norm)}`] : []),
      person.followed ? 'Suivie par la caméra' : 'Dans le champ, non suivie',
      `En vue depuis ${Math.floor(person.age)} s · ${1 + intruder.others.length} en vue`,
    ],
    color: STATUS_COLORS.critical,
  }
}

// The card for what the sight is on, null on nothing, or on someone the scene no longer tells of.
export function cardFor(pointed: Pointed | null, intel: Intel): Card | null {
  if (!pointed) return null
  if (pointed.kind === 'spot') return spotCard(pointed.id, intel)
  return intel.intruder && personCard(pointed.person, intel.intruder)
}

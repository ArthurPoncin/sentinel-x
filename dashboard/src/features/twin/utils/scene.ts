import { STATUS_COLORS } from '@/shared/config/status-colors'
import type { Alert, Severity, StatusLevel, Telemetry } from '@/shared/contract'
import { detectionLabel } from './detection'
import type { EnclosurePart } from './enclosure-parts'
import { gasLevel } from './gas-level'
import { heatLevel } from './heat-level'
import { alongPipe, type GroundPoint, gatePoint, SITE, sightBearing, standingPoint } from './site'

// What the Twin reads of the live feed: the fields of the live-feed state it needs, by shape, so
// the route hands them over without the twin feature importing live-feed.
export interface TwinState {
  // The feed's connection as it is now, and whether it has been open at least once.
  connection: 'connecting' | 'open' | 'closed'
  connectedOnce: boolean
  status: StatusLevel
  latestTelemetry: Telemetry | null
  activeAlerts: readonly Alert[]
}

// What the Twin is told of the feed it shows, which the feed's state does not say.
export interface TwinFeed {
  // Whether it is the live feed and travels encrypted, over WSS: never so for a replay, which is no link.
  encrypted: boolean
}

// The overall color grade the Status gives the scene.
export interface StatusGrade {
  // The Status itself: as it rises, the light is flooded in its color for a moment (escalation.ts).
  level: StatusLevel
  // The sky behind the Outpost.
  background: string
  // The light from the front and above, at rest: neutral whatever the Status, so the signals stand out of it.
  light: string
  // The light from behind, on the edges: the studio's cold one when nominal, the Status's color otherwise.
  rim: string
  // The ring around the socle.
  perimeter: string
}

export interface SceneProps {
  enclosure: {
    // The body's color, from dark anodized when calm to red at critical gas.
    color: string
    // How bright it glows and lights the ground around it, 0–1: the gas level.
    glow: number
    // What the LCD band shows, the Status, and the color it shows it in.
    lcd: { text: string; color: string }
    // The color the LED ring breathes in: the Status's.
    ring: { color: string }
    // The Alarm, on while a `gas` or `thermal` Alert is active: the LED ring blinks in `color`, that of the
    // highest severity among them, and the buzzer sounds. Null while it rests.
    alarm: { severity: Severity; color: string } | null
    // The Probes that pulse: those the `drivers` of the active `predictive` Alerts say are drifting, each once.
    pulses: readonly DriftingProbe[]
    // The label over the Probe compartment while Probes pulse: the `anomaly_score` of the last raised of the
    // `predictive` Alerts that pulse one, and the text that gives it. Null while none pulses.
    drift: { score: number; label: string } | null
  }
  // How thick the haze around the gas pipe is, 0–1: the gas level.
  haze: number
  status: StatusGrade
  // The heat of the generator hall.
  thermal: {
    // How red its roof glows, 0–1: the heat level.
    intensity: number
    // Whether the air ripples above it: while a `thermal` Alert is active.
    shimmer: boolean
  }
  // The zone of the perimeter the camera watches, the volume from its lens down to its sector on the ground:
  // lit while an `intrusion` Alert is active, wherever the intruder stands in it.
  sector: { lit: boolean }
  // How far the camera is turned from where it rests, in radians, positive toward the right of its image: the
  // `pan` of the last raised of the active `intrusion` Alerts, 0 without one, or for a camera that does not
  // turn. Its field turns with it. `aim` is how far its lens is drawn turned, the same way round: to the
  // intruder it follows, wherever they stand across its image, and with the field, by `pan`, without one.
  camera: { pan: number; aim: number }
  // The intruder the last raised of the active `intrusion` Alerts sees, the one its camera follows: where it
  // stands across the camera's image, 0 = left, 1 = right, and where on the ground that is (`at`), on the
  // camera's sight line, as far along it as it is short in the image. The Alert's id and the person's `key` in
  // it tell the same intruder moving from a new one: the first walks, the second appears. With it, how sure
  // the vision model is of what it sees, 0–1, and the label that says so. `x_norm`, `h_norm` and `pan` place
  // it: the Alert's `bbox` is not read. `others` are the other people that Alert sees, a figurine each, and
  // what the model tells of each.
  intruder: {
    alertId: string
    key: string
    x_norm: number
    confidence: number
    label: string
    at: GroundPoint
    others: readonly { key: string; at: GroundPoint; x_norm: number; confidence: number }[]
  } | null
  // Someone is near the site: a `presence` Alert is active. The Enclosure's PIR dome blinks and an amber
  // sweep goes round the fence for as long.
  presence: { active: boolean }
  // The floodlights on the perimeter: lit while a `presence` or an `intrusion` Alert is active, someone near
  // the site or inside it, dark otherwise.
  floodlights: { lit: boolean }
  // Where the last raised of the active Alerts happens on the site plan, its anchor: the intruder for an
  // `intrusion`, the gas pipe for a `gas`, the generator hall for a `thermal`, the gate for a `presence`, the
  // Enclosure for a `predictive`. A clap is heard, not seen anywhere: a `noise` Alert has none, and leaves the
  // anchor to the Alert raised before it. The camera turns to the anchor as its Alert is raised
  // (alert-framing.ts). Null while no Alert that has one is active.
  anchor: { alertId: string; at: GroundPoint } | null
  // The Enclosure's link to the Command Post, shown at its antenna.
  link: {
    // Whether the padlock and « WSS » show by the antenna: the live feed is encrypted, and open right now.
    encrypted: boolean
  }
  // The feed was open and no longer is: the scene shows what it last knew, not the Outpost as it is now.
  signalLost: boolean
  // What the Probes last read, as the feed gave it: for whoever points at a part of the site. Null before any.
  readings: Telemetry['readings'] | null
}

// Dark anodized metal: the Enclosure's body when the air is calm.
export const CALM_COLOR = '#2c343e'
export const GAS_COLOR = STATUS_COLORS.critical
// Metal heated red: what the generator hall's roof glows in. More orange than the critical Status, so heat
// is told from gas even while the whole model is flooded in red.
export const HEAT_COLOR = '#ff5a1f'
// The studio's own light: white from the front whatever the Status, cold from behind when nothing is wrong.
// Color is kept for the Status and the signals.
export const NEUTRAL_LIGHT = '#ffffff'
export const NEUTRAL_RIM = '#9dbcff'
// What the camera's field, and the sector on the ground under it, light in on an intrusion.
export const INTRUSION_COLOR = STATUS_COLORS.critical
// What the PIR dome blinks in and the fence is swept in on a presence: the amber of a warning.
export const PRESENCE_COLOR = STATUS_COLORS.elevated
// What the floodlights light in: white, which no Status shares. They show the site reacting, not how bad it is.
export const FLOODLIGHT_COLOR = '#ffffff'
// What a clap sends over the socle: a pale ice-white, which no Status shares. A `noise` Alert is only `info`, so
// its wave says something was heard, not that something is wrong.
export const NOISE_COLOR = '#cfe8ff'
// What the antenna's impulses, and the padlock by it, are drawn in: white, like the floodlights. The link
// beating says the feed is alive, not how the Outpost is.
export const LINK_COLOR = '#ffffff'
// What a drifting Probe pulses in: an orange of its own, to be told from the amber of an elevated Status.
export const DRIFT_COLOR = '#ff6a1a'

// The Probes the predictive model watches, by their key in ENCLOSURE_PARTS.
export type DriftingProbe = Extract<EnclosurePart, 'dht22' | 'mq2'>

// The Probe each `driver` of a `predictive` Alert is read from: the model's 7 features, the closed vocabulary
// of docs/ARCHITECTURE.md. A driver that is not here pulses nothing.
export const DRIVER_PROBES: ReadonlyMap<string, DriftingProbe> = new Map([
  ['temp', 'dht22'],
  ['temp_slope', 'dht22'],
  ['temp_mean', 'dht22'],
  ['humidity', 'dht22'],
  ['air', 'mq2'],
  ['air_slope', 'mq2'],
  ['air_mean', 'mq2'],
])

// What the label over the drifting Probes reads: the model's score, as the Alert gives it, to two decimals.
export function driftLabel(score: number): string {
  return `dérive · score ${score.toFixed(2)}`
}

// A Status that is not nominal colors what stands for it, the rim light and the ring around the socle, and
// leaves the light neutral: the whole model is lit in its color only for a moment, as it rises (escalation.ts).
function inStatusColor(level: Exclude<StatusLevel, 'nominal'>, background: string): StatusGrade {
  const color = STATUS_COLORS[level]
  return { level, background, light: NEUTRAL_LIGHT, rim: color, perimeter: color }
}

export const STATUS_GRADES: Readonly<Record<StatusLevel, StatusGrade>> = {
  nominal: {
    level: 'nominal',
    background: '#0b0f14',
    light: NEUTRAL_LIGHT,
    rim: NEUTRAL_RIM,
    perimeter: STATUS_COLORS.nominal,
  },
  elevated: inStatusColor('elevated', '#16110a'),
  critical: inStatusColor('critical', '#1a0a0b'),
}

function channels(color: string): number[] {
  const value = Number.parseInt(color.slice(1), 16)
  return [16, 8, 0].map((shift) => (value >> shift) & 0xff)
}

// The color `share` of the way from `from` to `to`, both `#rrggbb`.
export function mix(from: string, to: string, share: number): string {
  const end = channels(to)
  const mixed = channels(from).map((start, i) => Math.round(start + ((end[i] ?? start) - start) * share))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

// What the Enclosure's LCD reads for each Status, as the real one does.
export const LCD_TEXT: Readonly<Record<StatusLevel, string>> = {
  nominal: 'NOMINAL',
  elevated: 'ELEVATED',
  critical: 'CRITICAL',
}

// The severities, from the lowest up, and the Status each one raises at the Command Post: the Alarm takes
// that Status's color.
const SEVERITIES: readonly Severity[] = ['info', 'warning', 'critical']
const SEVERITY_LEVEL: Readonly<Record<Severity, StatusLevel>> = {
  info: 'nominal',
  warning: 'elevated',
  critical: 'critical',
}

type Intrusion = Extract<Alert, { kind: 'intrusion' }>

// How far the camera that sees an `intrusion` is turned, in radians: the Alert tells it in degrees, and not at
// all when its camera does not turn.
const panOf = ({ detail }: Intrusion) => ((detail.pan ?? 0) * Math.PI) / 180

// Where the people an `intrusion` Alert sees stand on the ground: the one its camera follows, then the others.
// Each has a key of their own in the Alert, the `id` it gives them; an Alert that gives none sees one person.
function peopleOf(alert: Intrusion) {
  const { x_norm, h_norm, id, others = [] } = alert.detail
  const pan = panOf(alert)

  return {
    followed: { key: String(id ?? 0), at: standingPoint(x_norm, pan, h_norm) },
    others: others.map((other) => ({
      key: String(other.id),
      at: standingPoint(other.x_norm, pan, other.h_norm),
      x_norm: other.x_norm,
      confidence: other.confidence,
    })),
  }
}

// Where an Alert happens on the site plan, for the camera to turn to: its anchor. The gas leaks along the pipe,
// taken at its middle; the intruder stands where the Twin stands it.
function anchorOf(alert: Alert): GroundPoint | null {
  switch (alert.kind) {
    case 'intrusion':
      return peopleOf(alert).followed.at
    case 'gas':
      return alongPipe(0.5)
    case 'thermal':
      return { x: SITE.hall.x, z: SITE.hall.z }
    case 'presence':
      return gatePoint()
    case 'predictive':
      return { x: SITE.enclosure.x, z: SITE.enclosure.z }
    case 'noise':
      return null
  }
}

// The live state as the scene shows it: pure, no WebGL, so it is tested without a render. Unless `feed` says
// it is encrypted, the feed is taken for one that is not: the Twin shows no padlock it was not told of.
export function toScene(state: TwinState, feed: TwinFeed = { encrypted: false }): SceneProps {
  const glow = gasLevel(state.latestTelemetry?.readings.air ?? null)
  const pulses = new Set<DriftingProbe>()
  let driftScore: number | null = null
  let intruder: SceneProps['intruder'] = null
  let pan = 0
  let aim = 0
  let anchor: SceneProps['anchor'] = null
  let present = false
  let shimmer = false
  // The highest severity among the Alerts the Sentinel fires its Alarm on. The contract does not carry the
  // Alarm's own state: an Alarm the Operator silenced still shows here.
  let alarm: Severity | null = null
  for (const alert of state.activeAlerts) {
    if (alert.kind === 'presence') present = true
    if (alert.kind === 'thermal') shimmer = true
    if (alert.kind === 'predictive') {
      const probes = alert.detail.drivers.flatMap((driver) => DRIVER_PROBES.get(driver) ?? [])
      for (const probe of probes) pulses.add(probe)
      // An Alert that names no Probe the Twin knows has nothing to label.
      if (probes.length > 0) driftScore = alert.detail.anomaly_score
    }
    if (alert.kind === 'intrusion') {
      const { x_norm, confidence } = alert.detail
      const { followed, others } = peopleOf(alert)
      intruder = { alertId: alert.alert_id, ...followed, x_norm, confidence, label: detectionLabel(confidence), others }
      pan = panOf(alert)
      // From the bearing the camera rests on to the one it sights the intruder along.
      aim = SITE.enclosure.heading - sightBearing(x_norm, pan)
    }
    if (alert.kind === 'gas' || alert.kind === 'thermal') {
      if (alarm === null || SEVERITIES.indexOf(alert.severity) > SEVERITIES.indexOf(alarm)) alarm = alert.severity
    }
    const at = anchorOf(alert)
    if (at) anchor = { alertId: alert.alert_id, at }
  }

  const status = STATUS_GRADES[state.status]

  return {
    enclosure: {
      color: mix(CALM_COLOR, GAS_COLOR, glow),
      glow,
      lcd: { text: LCD_TEXT[state.status], color: status.perimeter },
      ring: { color: status.perimeter },
      alarm: alarm && { severity: alarm, color: STATUS_COLORS[SEVERITY_LEVEL[alarm]] },
      pulses: [...pulses],
      drift: driftScore === null ? null : { score: driftScore, label: driftLabel(driftScore) },
    },
    // On the range of the Enclosure's glow: both are the gas level.
    haze: glow,
    status,
    thermal: { intensity: heatLevel(state.latestTelemetry?.readings.temp ?? null), shimmer },
    sector: { lit: intruder !== null },
    camera: { pan, aim },
    intruder,
    presence: { active: present },
    floodlights: { lit: present || intruder !== null },
    anchor,
    // A feed that is not open encrypts nothing: no padlock before the first connection, nor on a signal lost.
    link: { encrypted: feed.encrypted && state.connection === 'open' },
    // Not open is not enough: before the first connection, and while that one is still being tried,
    // there is no signal to have lost. After it, a retry in progress is still a signal lost.
    signalLost: state.connectedOnce && state.connection !== 'open',
    readings: state.latestTelemetry?.readings ?? null,
  }
}

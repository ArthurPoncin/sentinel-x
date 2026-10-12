import type { Frame } from '@/shared/contract'
import { autoOrbitSpeed, type CameraTouch, resumeRamp } from './auto-orbit'
import { framesSince } from './noise'
import type { GroundPoint } from './site'

// Seconds the camera takes to turn to an Alert's anchor, however far round the site that is.
export const FRAMING_TURN = 2
// Seconds it then stays facing it, before the automatic orbit resumes.
export const FRAMING_HOLD = 6
// The most of what is left to turn that the camera closes in a second. It holds the camera on the anchor once
// it faces it, and keeps the end of the turn from being a snap.
export const FRAMING_PULL = 4

// An Alert the camera turns to: its anchor on the site plan, and when it was raised, in seconds on the clock
// of CameraTouch.
export interface Framing {
  anchor: GroundPoint
  since: number
}

// What the camera frames on its own, each on its own: the last Alert it turned to, and when it last stood back
// for a wide shot, on the same clock. An Alert on the whole Outpost, an attack on its Command Post, happens
// nowhere on the ground: the camera stands back for it instead of turning. Null before the first of each.
export interface Shots {
  framing: Framing | null
  wide: number | null
}

// What turns the camera at an instant, when the Operator's hand does not.
export interface CameraTurn {
  // Radians a second the camera goes round the site by to face the Alert's anchor: positive toward growing
  // bearings, 0 when it has none to turn to.
  toAnchor: number
  // Share of its full speed the automatic orbit turns at, 0–1.
  orbit: number
}

// The Alerts raised for the first time among the frames that came after `seen`, by alert_id, in the order they
// came. One raised again while it is active, the intruder that moved or the gas that got worse, is not new: its
// alert_id pairs it with the first, as the feed does. Like a clap, an Alert already in the history when the
// Twin opens is past, and so is a history that does not follow on from `seen`.
export function newlyRaised(seen: readonly Frame[], frames: readonly Frame[]): string[] {
  const from = frames.length - framesSince(seen, frames).length
  if (from === frames.length) return []
  const active = new Set<string>()
  const raised: string[] = []
  for (const [index, frame] of frames.entries()) {
    if (frame.type !== 'alert') continue
    const { alert_id, state } = frame.payload
    if (state === 'cleared') {
      active.delete(alert_id)
      continue
    }
    if (index >= from && !active.has(alert_id)) raised.push(alert_id)
    active.add(alert_id)
  }
  return raised
}

// The shots after the Alerts in `raised` came in at `now`: the camera turns to the scene's anchor when its
// Alert is among them, and stands back when the one in `whole` is, the Alert that is on the whole Outpost.
// One does not undo the other: an intruder seen during an attack turns the camera, which stays back. Otherwise
// the shots it had: an Alert sent again is not raised, and frames nothing a second time.
export function shotsAfter(
  shots: Shots,
  raised: readonly string[],
  anchor: { alertId: string; at: GroundPoint } | null,
  whole: string | null,
  now: number,
): Shots {
  const onAnchor = anchor !== null && raised.includes(anchor.alertId)
  const onWhole = whole !== null && raised.includes(whole)
  if (!onAnchor && !onWhole) return shots
  return {
    framing: onAnchor ? { anchor: anchor.at, since: now } : shots.framing,
    wide: onWhole ? now : shots.wide,
  }
}

// The angle to turn by to go from one bearing to another the shortest way round, in radians: half a turn at
// most either way, positive toward growing bearings.
export function shortestTurn(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

// The share of what is left to turn that the camera closes a second, `elapsed` seconds after the Alert was
// raised. It follows an eased turn of FRAMING_TURN seconds, slow out of the orbit and slow onto the anchor,
// from where the camera now is, not from where it started: nothing to remember, and a camera that is not where
// the turn expected it still ends on the anchor.
function pull(elapsed: number): number {
  const share = Math.max(0, elapsed) / FRAMING_TURN
  if (share >= 1) return FRAMING_PULL
  // A smoothstep's speed over what it has left to go: 6s(1 − s) over (1 − s)²(1 + 2s).
  return Math.min(FRAMING_PULL, (6 * share) / ((1 - share) * (1 + 2 * share)) / FRAMING_TURN)
}

// The share of what is left to stand back that the camera closes a second at `now`, for a wide shot taken at
// `wide`: it goes out to where the whole Outpost shows as it turns to an anchor, eased over FRAMING_TURN
// seconds, and is held there for the hold. 0 without a wide shot, and once the Operator's hand has taken the
// camera, while they hold it and once they have touched it since the Alert was raised. It then stays where it
// stands: the Operator brings it back in.
export function standBack(wide: number | null, touch: CameraTouch, now: number): number {
  if (wide === null || touch.kind === 'holding') return 0
  if (touch.kind === 'released' && touch.at >= wide) return 0
  const elapsed = now - wide
  return elapsed < FRAMING_TURN + FRAMING_HOLD ? pull(elapsed) : 0
}

// How the camera turns on its own at `now`, seen from `azimuth`, the bearing it stands at around the site. It
// goes to the bearing of the Alert's anchor the shortest way round, stays there, then leaves it to the
// automatic orbit, which picks up speed as it does after the Operator. Facing the anchor is standing on its
// side of the site: the camera looks at the centre, the anchor is in front of it.
// The Operator's hand comes first: while they hold the camera, and once they have touched it since the Alert
// was raised, the framing is over and the orbit waits its usual delay.
export function cameraTurn(framing: Framing | null, azimuth: number, touch: CameraTouch, now: number): CameraTurn {
  const orbit = autoOrbitSpeed(touch, now)
  if (!framing || touch.kind === 'holding') return { toAnchor: 0, orbit }
  if (touch.kind === 'released' && touch.at >= framing.since) return { toAnchor: 0, orbit }

  const elapsed = now - framing.since
  const held = elapsed - FRAMING_TURN - FRAMING_HOLD
  if (held >= 0) return { toAnchor: 0, orbit: Math.min(orbit, resumeRamp(held)) }

  const { x, z } = framing.anchor
  return { toAnchor: pull(elapsed) * shortestTurn(azimuth, Math.atan2(x, z)), orbit: 0 }
}

import { useEffect, useRef } from 'react'
import type { Hand, Vec3 } from '../api/hand-frame'
import type { Shown } from '../utils/demo'
import { type Camera, project, type Viewpoint } from '../utils/hologram'
import { handLines } from '../utils/skeleton'
import { DEAD_ZONE, NEUTRAL } from '../utils/steer'

// What a hand is drawn in: the white of its bones' core, the blue of the bones, and the deeper one of their halo.
const INK = { core: '#f2fbff', bone: '#9fdcff', halo: '#2f9bff' } as const
const light = (share: number) => `rgba(159, 220, 255, ${share})`
const white = (share: number) => `rgba(242, 251, 255, ${share})`

// A hand's bones and joints, in millimetres across.
const BONE = { halo: 6, core: 1.6, joint: 4.2 } as const
// The hand sensor's own footprint on the desk, in millimetres: 80 across, 30 deep.
const SENSOR = { width: 80, depth: 30 } as const
// The desk round the sensor: how far the grid goes from it, and between its lines.
const FLOOR = { half: 300, step: 50 } as const

// What a hologram frames: the desk with the sensor on it and the space over it, or one hand from close by. The
// span is the millimetres its shorter side shows.
const STAGE = { target: [0, 150, -10] as Vec3, distance: 900, span: 410 } as const
const CLOSE = { target: [0, 200, -35] as Vec3, distance: 800, span: 300 } as const
// The stage turns slowly from side to side, by this many radians and once in this many seconds: what is in
// depth shows as such.
const SWAY = { by: 0.2, every: 14 } as const
// How far past its tip a shot is drawn, and how far from the palm the ring of a thumb held is, in millimetres.
const BEAM = 320
const HOLD_RING = 68

type Screen = (point: Vec3) => [x: number, y: number, size: number]
const TURN = 2 * Math.PI

function trace(context: CanvasRenderingContext2D, to: Screen, points: readonly Vec3[], closed = false) {
  context.beginPath()
  for (const [index, point] of points.entries()) {
    const [x, y] = to(point)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  if (closed) context.closePath()
}

const ring = (centre: Vec3, radius: number): Vec3[] =>
  Array.from({ length: 48 }, (_, step) => {
    const angle = (step * TURN) / 48
    return [centre[0] + radius * Math.cos(angle), centre[1], centre[2] + radius * Math.sin(angle)]
  })

// The desk under the hands: a grid that fades away from the sensor, the sensor, and over it the place a flat
// hand rests at, where it moves nothing.
function drawDesk(context: CanvasRenderingContext2D, to: Screen, unit: number) {
  context.lineWidth = unit
  for (let at = -FLOOR.half; at <= FLOOR.half; at += FLOOR.step) {
    context.strokeStyle = light(0.16 * (1 - (0.85 * Math.abs(at)) / FLOOR.half))
    trace(context, to, [[at, 0, -FLOOR.half], [at, 0, FLOOR.half]])
    context.stroke()
    trace(context, to, [[-FLOOR.half, 0, at], [FLOOR.half, 0, at]])
    context.stroke()
  }

  const [w, d] = [SENSOR.width / 2, SENSOR.depth / 2]
  trace(context, to, [[-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d]], true)
  context.fillStyle = light(0.22)
  context.fill()
  context.shadowColor = INK.halo
  context.shadowBlur = 12 * unit
  context.strokeStyle = INK.bone
  context.lineWidth = 1.5 * unit
  context.stroke()
  context.shadowBlur = 0

  context.setLineDash([4 * unit, 6 * unit])
  context.strokeStyle = light(0.2)
  trace(context, to, [[0, 0, 0], NEUTRAL])
  context.stroke()
  context.strokeStyle = light(0.5)
  trace(context, to, ring(NEUTRAL, DEAD_ZONE), true)
  context.stroke()
  context.setLineDash([])
}

// With no hand over it, the sensor looks for one: rings that rise from it and widen as they fade.
function drawSearch(context: CanvasRenderingContext2D, to: Screen, unit: number, seconds: number) {
  context.lineWidth = 1.5 * unit
  for (let wave = 0; wave < 3; wave++) {
    const risen = (seconds * 0.4 + wave / 3) % 1
    context.strokeStyle = light(0.55 * (1 - risen))
    trace(context, to, ring([0, risen * 230, 0], 28 + risen * 95), true)
    context.stroke()
  }
}

function bones(context: CanvasRenderingContext2D, to: Screen, hand: Hand, flatten: boolean) {
  context.beginPath()
  for (const [from, end] of handLines(hand)) {
    const [x1, y1] = to(flatten ? [from[0], 0, from[2]] : from)
    const [x2, y2] = to(flatten ? [end[0], 0, end[2]] : end)
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
  }
}

// A hand of light: its palm as a pane, its bones with a halo round a white core, and a bead at each joint.
function drawHand(context: CanvasRenderingContext2D, to: Screen, hand: Hand, unit: number) {
  const [, index, middle, third, pinky] = hand.fingers
  const [, , size] = to(hand.palm)

  trace(context, to, [index.joints[0], index.joints[1], middle.joints[1], third.joints[1], pinky.joints[1], pinky.joints[0]], true)
  context.fillStyle = light(0.13)
  context.fill()

  context.shadowColor = INK.halo
  context.shadowBlur = 16 * unit
  context.strokeStyle = INK.bone
  context.lineWidth = Math.max(1.5 * unit, BONE.halo * size)
  bones(context, to, hand, false)
  context.stroke()

  context.fillStyle = INK.core
  context.beginPath()
  for (const { joints } of hand.fingers) {
    for (const joint of joints.slice(1)) {
      const [x, y, at] = to(joint)
      const radius = Math.max(1.5 * unit, BONE.joint * at)
      context.moveTo(x + radius, y)
      context.arc(x, y, radius, 0, TURN)
    }
  }
  context.fill()
  context.shadowBlur = 0

  context.strokeStyle = white(0.9)
  context.lineWidth = Math.max(0.75 * unit, BONE.core * size)
  bones(context, to, hand, false)
  context.stroke()
}

// Round a thumb that is held, the ring that fills while it is, and the one that leaves it once it came through.
function drawHold(context: CanvasRenderingContext2D, to: Screen, hand: Hand, unit: number, hold: number, flash: number) {
  const [x, y, size] = to(hand.palm)
  const radius = HOLD_RING * size
  context.lineWidth = 2 * unit
  context.strokeStyle = light(0.22)
  context.beginPath()
  context.arc(x, y, radius, 0, TURN)
  context.stroke()

  context.shadowColor = INK.halo
  context.shadowBlur = 12 * unit
  context.lineWidth = 3 * unit
  context.strokeStyle = INK.core
  context.beginPath()
  context.arc(x, y, radius, -TURN / 4, -TURN / 4 + hold * TURN)
  context.stroke()
  if (flash > 0) {
    context.strokeStyle = white(flash)
    context.beginPath()
    context.arc(x, y, radius * (1 + 0.3 * (1 - flash)), 0, TURN)
    context.stroke()
  }
  context.shadowBlur = 0
}

// A shot: a line of light on from the tip of the index, and a burst at the tip, both fading.
function drawShot(context: CanvasRenderingContext2D, to: Screen, hand: Hand, unit: number, flash: number) {
  const [tip, before] = [hand.fingers[1].joints[4], hand.fingers[1].joints[3]]
  const along: Vec3 = [tip[0] - before[0], tip[1] - before[1], tip[2] - before[2]]
  const reach = BEAM / (Math.hypot(...along) || 1)
  context.shadowColor = INK.halo
  context.shadowBlur = 14 * unit
  context.strokeStyle = white(flash)
  context.lineWidth = 2.5 * unit
  trace(context, to, [tip, [tip[0] + along[0] * reach, tip[1] + along[1] * reach, tip[2] + along[2] * reach]])
  context.stroke()
  const [x, y, size] = to(tip)
  context.beginPath()
  context.arc(x, y, (8 + 26 * (1 - flash)) * size, 0, TURN)
  context.stroke()
  context.shadowBlur = 0
}

function paint(
  context: CanvasRenderingContext2D,
  { width, height, unit }: { width: number; height: number; unit: number },
  camera: Camera,
  span: number,
  { hands, hold, flash }: Shown,
  // The desk under the hands, and the seconds its search goes by: null for one that stands still.
  desk: { seconds: number | null } | null,
) {
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, width, height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const zoom = Math.min(width, height) / span
  const to: Screen = (point) => {
    const [x, y, scale] = project(point, camera)
    return [width / 2 + x * zoom, height / 2 + y * zoom, scale * zoom]
  }

  if (desk) {
    drawDesk(context, to, unit)
    if (hands.length === 0 && desk.seconds !== null) drawSearch(context, to, unit, desk.seconds)
    // Each hand's shadow on the desk: how high it is over it shows.
    context.strokeStyle = 'rgba(47, 155, 255, 0.16)'
    for (const hand of hands) {
      context.lineWidth = BONE.halo * to([hand.palm[0], 0, hand.palm[2]])[2]
      bones(context, to, hand, true)
      context.stroke()
    }
  }
  for (const hand of hands) {
    drawHand(context, to, hand, unit)
    if (hold !== null) drawHold(context, to, hand, unit, hold, flash)
    else if (flash > 0) drawShot(context, to, hand, unit, flash)
  }
}

interface HandHologramProps {
  // The hands to draw at an instant, by the seconds of the page's clock.
  show: (seconds: number) => Shown
  from: Viewpoint
  // The whole desk with the sensor on it, rather than one hand from close by.
  stage?: boolean
  // Nothing moves by itself: a played gesture stays at its first instant, and the stage does not turn.
  still?: boolean
  label: string
  className?: string
}

// Hands as the sensor's own viewer shows them: of blue light, in depth, drawn again on every frame the screen
// shows without a render in between. Takes the size it is given.
export function HandHologram({ show, from, stage = false, still = false, label, className }: HandHologramProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const drawn = canvas.current
    const context = drawn?.getContext('2d')
    if (!drawn || !context) return

    const draw = () => {
      const unit = window.devicePixelRatio || 1
      const [width, height] = [Math.round(drawn.clientWidth * unit), Math.round(drawn.clientHeight * unit)]
      if (drawn.width !== width || drawn.height !== height) {
        drawn.width = width
        drawn.height = height
      }
      if (width === 0 || height === 0) return
      const seconds = performance.now() / 1000
      const frame = stage ? STAGE : CLOSE
      const yaw = from.yaw + (stage && !still ? SWAY.by * Math.sin((seconds * TURN) / SWAY.every) : 0)
      // Live hands move whatever was asked: only what the page plays by itself stands still.
      const shown = show(still && !stage ? 0 : seconds)
      paint(context, { width, height, unit }, { ...frame, yaw, pitch: from.pitch }, frame.span, shown, stage ? { seconds: still ? null : seconds } : null)
    }

    if (still && !stage) {
      const resized = new ResizeObserver(draw)
      resized.observe(drawn)
      return () => resized.disconnect()
    }
    let frame = requestAnimationFrame(function step() {
      draw()
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [show, from, stage, still])

  return <canvas ref={canvas} className={className} role="img" aria-label={label} />
}

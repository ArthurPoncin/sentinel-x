import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, Spherical, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Frame } from '@/shared/contract'
import { useFraming } from '../hooks/use-framing'
import { cameraTurn } from '../utils/alert-framing'
import type { CameraTouch } from '../utils/auto-orbit'
import { TARGET, wholeStageDistance } from '../utils/framing'
import { type OperatorHands, steered } from '../utils/operator-hands'
import type { SceneProps } from '../utils/scene'

// Seconds the automatic orbit takes to go once around the Outpost.
const ORBIT_PERIOD = 80
// Close enough to read the Enclosure, far enough to still see the whole perimeter.
const MIN_DISTANCE = 4
const MAX_DISTANCE = 12
// From a bird's-eye view down to just above the ground, never under it.
const MIN_POLAR = MathUtils.degToRad(25)
const MAX_POLAR = MathUtils.degToRad(82)
// The longest a frame is taken to last on the way to an Alert: after one that took longer, the tab coming
// back, the camera turns no further than this, and never past the anchor.
const LONGEST_FRAME = 0.1
// What the camera turns around: the vertical through its target.
const UP = new Vector3(0, 1, 0)

const seconds = () => performance.now() / 1000

export interface OrbitCameraProps {
  // Where the last raised of the active Alerts happens, from the scene: the camera turns to face it as the
  // Alert is raised, stays a few seconds, then orbits again.
  anchor: SceneProps['anchor']
  // The feed's frames, oldest first: an Alert is newly raised when it is among those that come in.
  frames: readonly Frame[]
  // Stands back just far enough to hold the whole stage, whatever the shape of the frame. The Operator can
  // still turn the camera, no longer zoom.
  wholeStage?: boolean
  // The Operator's hands over a sensor, when they have one: a flat hand steers the camera as a drag does, and
  // the orbit waits for it the same way.
  operator?: OperatorHands
}

export function OrbitCamera({ anchor, frames, wholeStage = false, operator }: OrbitCameraProps) {
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const controls = useRef<OrbitControls | null>(null)
  const touch = useRef<CameraTouch>({ kind: 'never' })
  // Whether a hand over the sensor holds the camera, and whether the mouse does: either one is the Operator's.
  const hand = useRef(false)
  const mouse = useRef(false)
  const stand = useRef(new Spherical())
  const framingNow = useFraming(anchor, frames)

  useEffect(() => {
    const orbit = new OrbitControls(camera, canvas)
    orbit.target.set(...TARGET)
    orbit.enablePan = false
    orbit.enableDamping = true
    // With the whole stage in frame the distance is not the Operator's to set: a wheel notch must not even
    // pause the orbit.
    orbit.enableZoom = !wholeStage
    orbit.autoRotate = true
    orbit.minDistance = MIN_DISTANCE
    orbit.maxDistance = MAX_DISTANCE
    orbit.minPolarAngle = MIN_POLAR
    orbit.maxPolarAngle = MAX_POLAR
    // A wheel notch is a start and an end at once: it restarts the idle delay like a drag does.
    orbit.addEventListener('start', () => {
      mouse.current = true
      touch.current = { kind: 'holding' }
    })
    orbit.addEventListener('end', () => {
      mouse.current = false
      if (!hand.current) touch.current = { kind: 'released', at: seconds() }
    })
    controls.current = orbit

    return () => {
      controls.current = null
      orbit.dispose()
    }
  }, [camera, canvas, wholeStage])

  useFrame(({ size }, delta) => {
    const orbit = controls.current
    if (!orbit) return
    // Both bounds at once: the controls bring the camera there, and follow the frame when it changes shape.
    if (wholeStage) orbit.minDistance = orbit.maxDistance = wholeStageDistance(size.width / size.height)
    // The hand first: it moves the camera round its target, and the controls then read where it is.
    const steer = operator?.steer() ?? null
    if (steer) {
      hand.current = true
      touch.current = { kind: 'holding' }
      const from = stand.current.setFromVector3(camera.position.sub(orbit.target))
      const to = steered({ azimuth: from.theta, polar: from.phi, distance: from.radius }, steer, Math.min(delta, LONGEST_FRAME), {
        minPolar: MIN_POLAR,
        maxPolar: MAX_POLAR,
        minDistance: orbit.minDistance,
        maxDistance: orbit.maxDistance,
      })
      camera.position.setFromSphericalCoords(to.distance, to.polar, to.azimuth).add(orbit.target)
    } else if (hand.current) {
      // The hand let go: the orbit waits its usual delay, unless the mouse holds the camera still.
      hand.current = false
      if (!mouse.current) touch.current = { kind: 'released', at: seconds() }
    }
    const turn = cameraTurn(framingNow(), orbit.getAzimuthalAngle(), touch.current, seconds())
    // Round the target's vertical, at the distance and the height the camera stands at: the controls then read
    // where it is, as they do after a drag.
    if (turn.toAnchor !== 0) {
      const angle = turn.toAnchor * Math.min(delta, LONGEST_FRAME)
      camera.position.sub(orbit.target).applyAxisAngle(UP, angle).add(orbit.target)
    }
    // OrbitControls counts autoRotateSpeed in turns per minute.
    orbit.autoRotateSpeed = (60 / ORBIT_PERIOD) * turn.orbit
    orbit.update(delta)
  })

  return null
}

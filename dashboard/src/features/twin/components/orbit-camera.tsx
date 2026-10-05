import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { autoOrbitSpeed, type CameraTouch } from '../utils/auto-orbit'
import { TARGET, wholeStageDistance } from '../utils/framing'

// Seconds the automatic orbit takes to go once around the Outpost.
const ORBIT_PERIOD = 80
// Close enough to read the Enclosure, far enough to still see the whole perimeter.
const MIN_DISTANCE = 4
const MAX_DISTANCE = 12
// From a bird's-eye view down to just above the ground, never under it.
const MIN_POLAR = MathUtils.degToRad(25)
const MAX_POLAR = MathUtils.degToRad(82)

const seconds = () => performance.now() / 1000

export interface OrbitCameraProps {
  // Stands back just far enough to hold the whole stage, whatever the shape of the frame. The Operator can
  // still turn the camera, no longer zoom.
  wholeStage?: boolean
}

export function OrbitCamera({ wholeStage = false }: OrbitCameraProps) {
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const controls = useRef<OrbitControls | null>(null)
  const touch = useRef<CameraTouch>({ kind: 'never' })

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
      touch.current = { kind: 'holding' }
    })
    orbit.addEventListener('end', () => {
      touch.current = { kind: 'released', at: seconds() }
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
    // OrbitControls counts autoRotateSpeed in turns per minute.
    orbit.autoRotateSpeed = (60 / ORBIT_PERIOD) * autoOrbitSpeed(touch.current, seconds())
    orbit.update(delta)
  })

  return null
}

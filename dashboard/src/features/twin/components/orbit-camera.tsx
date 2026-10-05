import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { autoOrbitSpeed, type CameraTouch } from '../utils/auto-orbit'

// Seconds the automatic orbit takes to go once around the Outpost.
const ORBIT_PERIOD = 80
// The camera turns around this point and cannot be panned away from it, so the Outpost stays centred.
const TARGET = [0, 0.5, 0] as const
// Close enough to read the Enclosure, far enough to still see the whole perimeter.
const MIN_DISTANCE = 4
const MAX_DISTANCE = 12
// From a bird's-eye view down to just above the ground, never under it.
const MIN_POLAR = MathUtils.degToRad(25)
const MAX_POLAR = MathUtils.degToRad(82)

const seconds = () => performance.now() / 1000

export function OrbitCamera() {
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const controls = useRef<OrbitControls | null>(null)
  const touch = useRef<CameraTouch>({ kind: 'never' })

  useEffect(() => {
    const orbit = new OrbitControls(camera, canvas)
    orbit.target.set(...TARGET)
    orbit.enablePan = false
    orbit.enableDamping = true
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
  }, [camera, canvas])

  useFrame((_, delta) => {
    const orbit = controls.current
    if (!orbit) return
    // OrbitControls counts autoRotateSpeed in turns per minute.
    orbit.autoRotateSpeed = (60 / ORBIT_PERIOD) * autoOrbitSpeed(touch.current, seconds())
    orbit.update(delta)
  })

  return null
}

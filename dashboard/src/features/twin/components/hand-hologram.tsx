import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  type Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  type PerspectiveCamera,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import {
  HAND_COLORS,
  handBones,
  handJoints,
  HOLOGRAM,
  hologramAnchor,
  hologramPoint,
  MOST_BONES,
  MOST_JOINTS,
  type OperatorHands,
} from '../utils/operator-hands'

// How much brighter than its color the hologram is, for the halo to take it for a light, and how much more
// once what the hand confirms is done.
const GLOW = 1.6
const CHARGED = 2.4
// The share of the way to its tint the hologram's color goes in a second.
const TINT_PULL = 8
const UP = new Vector3(0, 1, 0)
// Leant back round the screen's horizontal: the far side of the hand goes up.
const LEAN = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), HOLOGRAM.lean)

// The Operator's hands in hologram, as the sensor sees them: bones and joints of light in the lower left of
// the view, which ride with the camera wherever it stands, so that a hand moved to the right goes to the right
// of the screen and the Outpost stays clear. Cold white while it steers, it turns to the nominal green as a
// thumb is raised and to the critical red as one is turned down, and brightens as the hold completes. Nothing
// of it is there without a hand over the sensor.
export function HandHologram({ operator }: { operator: OperatorHands }) {
  const group = useRef<Group>(null)
  const parts = useMemo(() => {
    const material = () =>
      new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false })
    // A cylinder along y, one unit long: a bone is it stretched from one joint to the next.
    const bones = new InstancedMesh(new CylinderGeometry(HOLOGRAM.bone, HOLOGRAM.bone, 1, 6), material(), HOLOGRAM.most * MOST_BONES)
    const joints = new InstancedMesh(new SphereGeometry(HOLOGRAM.joint, 10, 8), material(), HOLOGRAM.most * MOST_JOINTS)
    for (const mesh of [bones, joints]) {
      mesh.count = 0
      // Drawn after the site, and whole: its instances move every frame, nothing to cull it by.
      mesh.renderOrder = 10
      mesh.frustumCulled = false
    }
    return { bones, joints }
  }, [])
  useEffect(
    () => () => {
      for (const mesh of [parts.bones, parts.joints]) {
        mesh.geometry.dispose()
        ;(mesh.material as MeshBasicMaterial).dispose()
        mesh.dispose()
      }
    },
    [parts],
  )
  const scratch = useMemo(
    () => ({ at: new Object3D(), from: new Vector3(), to: new Vector3(), along: new Vector3(), tint: new Color(), lit: new Color(HAND_COLORS.idle) }),
    [],
  )

  useFrame(({ camera }, delta) => {
    const hands = operator.hands().slice(0, HOLOGRAM.most)
    const { at, from, to, along, tint, lit } = scratch
    let bones = 0
    let joints = 0

    for (const hand of hands) {
      for (const [start, end] of handBones(hand)) {
        from.set(...hologramPoint(start))
        to.set(...hologramPoint(end))
        along.subVectors(to, from)
        const length = along.length()
        if (length === 0) continue
        at.position.addVectors(from, to).multiplyScalar(0.5)
        at.quaternion.setFromUnitVectors(UP, along.divideScalar(length))
        at.scale.set(1, length, 1)
        at.updateMatrix()
        parts.bones.setMatrixAt(bones++, at.matrix)
      }
      for (const joint of handJoints(hand)) {
        at.position.set(...hologramPoint(joint))
        at.quaternion.identity()
        at.scale.setScalar(1)
        at.updateMatrix()
        parts.joints.setMatrixAt(joints++, at.matrix)
      }
    }
    parts.bones.count = bones
    parts.joints.count = joints
    parts.bones.instanceMatrix.needsUpdate = true
    parts.joints.instanceMatrix.needsUpdate = true

    // In front of the camera and turned as it is, then leant back: the sensor's right is the screen's.
    const { fov, aspect } = camera as PerspectiveCamera
    group.current?.position.set(...hologramAnchor(fov, aspect)).applyQuaternion(camera.quaternion).add(camera.position)
    group.current?.quaternion.copy(camera.quaternion).multiply(LEAN)

    const [first] = hands
    if (!first) return
    tint.set(HAND_COLORS[first.tint])
    lit.lerp(tint, Math.min(1, TINT_PULL * delta))
    const glow = GLOW + (CHARGED - GLOW) * first.charge
    for (const mesh of [parts.bones, parts.joints]) (mesh.material as MeshBasicMaterial).color.copy(lit).multiplyScalar(glow)
  })

  return (
    <group ref={group}>
      <primitive object={parts.bones} />
      <primitive object={parts.joints} />
    </group>
  )
}

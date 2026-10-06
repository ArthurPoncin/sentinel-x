import { memo, useMemo } from 'react'
import { Color } from 'three'
import { INTRUSION_COLOR, type SceneProps } from '../utils/scene'
import { SITE } from '../utils/site'

// The figure: a body and a head, a little taller than the fence so it reads over it from the back of the room.
const BODY = { radius: 0.04, length: 0.2 } as const
const HEAD = { radius: 0.045, gap: 0.012 } as const
// The ring at its feet, flat on the ground, which marks the very point of the arc it stands on.
const RING = { inner: 0.085, outer: 0.115 } as const
// How bright it emits, in the intrusion's red.
const GLOW = 3
// Just outside the fence, against it, so the rails do not run through it: it comes from outside.
const OUTSIDE = BODY.radius + 0.012

export interface IntruderProps {
  // The intruder of the active `intrusion` Alerts, or null: there is none.
  intruder: SceneProps['intruder']
}

// The intruder the camera sees, standing on the arc of the fence it watches, where `x_norm` places it: a figure
// in the intrusion's red, with a ring at its feet. It moves to the new place as `x_norm` changes, and is gone
// once the last `intrusion` Alert is cleared. Unlit and brighter than white, so the halo takes it for a light.
// It casts no shadow: the shadows are drawn once, and it moves.
export const Intruder = memo(function Intruder({ intruder }: IntruderProps) {
  const red = useMemo(() => new Color(INTRUSION_COLOR).multiplyScalar(GLOW), [])
  if (!intruder) return null

  const { x, z } = intruder.at
  // From the arc out to where the figure stands: along the radius, away from the socle's centre.
  const outward = OUTSIDE / SITE.fence.radius
  const bodyTop = 2 * BODY.radius + BODY.length

  return (
    <group position={[x, 0, z]}>
      <group position={[x * outward, 0, z * outward]}>
        <mesh position={[0, bodyTop / 2, 0]}>
          <capsuleGeometry args={[BODY.radius, BODY.length, 6, 12]} />
          <meshBasicMaterial color={red} />
        </mesh>
        <mesh position={[0, bodyTop + HEAD.gap + HEAD.radius, 0]}>
          <sphereGeometry args={[HEAD.radius, 16, 12]} />
          <meshBasicMaterial color={red} />
        </mesh>
      </group>
      {/* On the arc itself, just above the camera's sector so it does not flicker into it. */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[RING.inner, RING.outer, 48]} />
        <meshBasicMaterial color={red} transparent depthWrite={false} />
      </mesh>
    </group>
  )
})

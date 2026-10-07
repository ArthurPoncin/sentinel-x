import { useFrame } from '@react-three/fiber'
import { memo, useRef } from 'react'
import { type InstancedMesh, Object3D } from 'three'
import { DUST, moteAt } from '../utils/dust'
import { OFF_WHITE } from './palette'

// How opaque a mote is: a speck that catches the light, dimmer than anything that says something.
const OPACITY = 0.4

// What places a mote, one after the other.
const mote = new Object3D()

// The dust in the air over the site: a few motes that drift slowly, all the one way, in a wind that never
// drops. The place is remote and left to itself. They are lit like the rest of the maquette, so they take the
// scene's light, the Status's flash included, and never glow: no signal is taken for one, and none is hidden
// by a speck a few pixels wide. One shape drawn in instances, which casts no shadow.
export const Dust = memo(function Dust() {
  const motes = useRef<InstancedMesh>(null)
  const seconds = useRef(0)

  useFrame((_, delta) => {
    seconds.current += delta
    const mesh = motes.current
    if (!mesh) return
    for (let index = 0; index < DUST.motes; index++) {
      const { x, y, z, size } = moteAt(index, seconds.current)
      mote.position.set(x, y, z)
      mote.scale.setScalar(size / 2)
      mote.updateMatrix()
      mesh.setMatrixAt(index, mote.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    // They move all over the site: never left out of the frame for where they were.
    <instancedMesh ref={motes} args={[undefined, undefined, DUST.motes]} frustumCulled={false} renderOrder={3}>
      <icosahedronGeometry args={[1, 0]} />
      <meshLambertMaterial color={OFF_WHITE} transparent opacity={OPACITY} depthWrite={false} />
    </instancedMesh>
  )
})

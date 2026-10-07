import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, Color, Euler, IcosahedronGeometry, type InstancedMesh, Matrix4, Vector3 } from 'three'
import { rocks } from '../utils/site'
import { ROCK } from './palette'

// How far in from the ball it is cut from a point of the rock may be pushed, as a share of its radius: what
// makes its facets uneven. Nothing is pushed out, so a rock holds in the footprint the site plan gives it.
const DENT = 0.34
// How much of its height a rock is sunk in the ground, so that it lies in it rather than on it.
const SUNK = 0.2
// How far from the shade of the rock a rock may be, lighter or darker: none is quite the shade of the next.
const SHADES = 0.08
// Each rock is tipped its own way, the same at every load: the golden angle spreads them.
const TIPPED = 2.4

// The one shape every rock is: a ball of a few facets, dented. Each of its points takes its dent from where
// it is, so the facets that share it stay joined.
function rockShape(): BufferGeometry {
  const rock = new IcosahedronGeometry(1, 1)
  const points = rock.getAttribute('position')
  const point = new Vector3()
  for (let index = 0; index < points.count; index++) {
    point.fromBufferAttribute(points, index)
    const dent = Math.sin(point.x * 12.9898 + point.y * 78.233 + point.z * 37.719) * 43758.5453
    point.multiplyScalar(1 - DENT * (dent - Math.floor(dent)))
    points.setXYZ(index, point.x, point.y, point.z)
  }
  rock.computeVertexNormals()
  return rock
}

// The rocks around the site, between the fence and the socle's rim, where the site plan lays them: the place
// is wild, and nobody clears it. Faceted, in the maquette's neutral tones, and all of them one shape drawn
// in instances, each tipped, turned and squashed its own way: one draw however many they are. They do not
// move: their shadows are drawn once, with all the others.
export const Rocks = memo(function Rocks() {
  const laid = useMemo(rocks, [])
  const shape = useMemo(rockShape, [])
  const drawn = useRef<InstancedMesh>(null)
  useEffect(() => () => shape.dispose(), [shape])

  useLayoutEffect(() => {
    const mesh = drawn.current
    if (!mesh) return
    const [placed, tipped, squashed] = [new Matrix4(), new Matrix4(), new Matrix4()]
    const tip = new Euler()
    const shade = new Color()
    laid.forEach(({ x, z, radius, height, turn }, index) => {
      // Tipped any way up, then squashed to its footprint and its height, so it stays level on the ground.
      tipped.makeRotationFromEuler(tip.set(index * TIPPED, turn, index * TIPPED * 1.7))
      squashed.makeScale(radius, height / (1 + SUNK), radius)
      placed
        .makeTranslation(x, (height * (1 - SUNK)) / (1 + SUNK), z)
        .multiply(squashed)
        .multiply(tipped)
      mesh.setMatrixAt(index, placed)
      mesh.setColorAt(index, shade.set(ROCK).offsetHSL(0, 0, SHADES * (((index * 0.618) % 1) - 0.5)))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [laid])

  return (
    <instancedMesh ref={drawn} args={[shape, undefined, laid.length]} castShadow receiveShadow>
      <meshStandardMaterial color="#ffffff" roughness={0.9} flatShading />
    </instancedMesh>
  )
})

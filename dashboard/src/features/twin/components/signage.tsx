import { memo, useEffect, useMemo } from 'react'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ENGRAVING } from '../utils/enclosure-parts'
import { dangerZone, gateSigns, hallSign, SITE } from '../utils/site'
import { useCanvasTexture } from './label-card'
import { GRAPHITE, OFF_WHITE, STEEL } from './palette'

// What the signs read. The site is AetherCorp's, as the Enclosure's engraving says, and its first Outpost.
const WORDS = { noEntry: 'ACCÈS INTERDIT', owner: ENGRAVING.maker, outpost: 'OUTPOST 01', gas: 'GAZ' } as const
// The signage is painted in the maquette's own tones, ink on plate: color is kept for the Status and the
// signals.
const INK = GRAPHITE
const PLATE = OFF_WHITE
const SANS = 'system-ui, sans-serif'
const MONO = 'ui-monospace, Menlo, Consolas, monospace'
// How far off what it is painted on a mark is drawn, so neither flickers into the other.
const PAINT = 0.002

// How thick a sign's plate is, and how far off the fence's line it hangs, clear of the mesh and the rails.
// Its face is reflective, as a road sign's is: it gives back `shine` of its own tones whatever the light,
// since the sign on the gate's left turns its back to the key light.
const SIGN = { thickness: 0.008, off: 0.012, shine: 0.3 } as const
// A sign's face, in pixels, and how far in from its edge the line of its border runs.
const FACE = { width: 600, height: 440, border: 14 } as const

function drawNoEntry(context: CanvasRenderingContext2D) {
  const { width, height, border } = FACE
  const middle = width / 2
  context.fillStyle = PLATE
  context.fillRect(0, 0, width, height)
  context.strokeStyle = INK
  context.lineWidth = 8
  context.beginPath()
  context.roundRect(border, border, width - 2 * border, height - 2 * border, 18)
  context.stroke()
  // Three lines as wide as the plate, to be read from as far as can be: the no-entry mark, a disc and its
  // bar, before the first word, the second word, then who forbids it.
  const [first = '', second = ''] = WORDS.noEntry.split(' ')
  const mark = { radius: 38, gap: 22 } as const
  context.fillStyle = INK
  context.font = `800 108px ${SANS}`
  const start = (width - 2 * mark.radius - mark.gap - context.measureText(first).width) / 2
  context.beginPath()
  context.arc(start + mark.radius, 99, mark.radius, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = PLATE
  context.fillRect(start + mark.radius - 25, 92, 50, 14)
  context.fillStyle = INK
  context.textAlign = 'left'
  context.fillText(first, start + 2 * mark.radius + mark.gap, 138)
  context.textAlign = 'center'
  context.fillText(second, middle, 250, width - 76)
  context.fillRect(60, 278, width - 120, 4)
  context.font = `700 92px ${SANS}`
  context.fillText(WORDS.owner, middle, 378, width - 76)
}

// The two signs' plates as one shape, where the site plan hangs them: each a thin slab that hangs from the
// top of the fence's mesh, outside it, under the barbed wire. The side that looks out of the site reads the
// face; the back and the edges are in the ink of its border.
function signPlates(): BufferGeometry {
  const { width, height } = SITE.signs.gate
  // A point of the border's line, at the foot of the face.
  const ink = [0.5, FACE.border / FACE.height] as const
  const plates = gateSigns().map(({ x, z, bearing }) => {
    const plate = new BoxGeometry(width, height, SIGN.thickness)
    // A box lists the corners of its sides four by four: +x, -x, +y, -y, +z, -z. Turned to the sign's bearing,
    // +z is the one that looks out.
    const uv = plate.getAttribute('uv')
    for (let corner = 0; corner < uv.count; corner++) {
      if (Math.floor(corner / 4) !== 4) uv.setXY(corner, ...ink)
    }
    return plate
      .translate(0, 0, SIGN.off + SIGN.thickness / 2)
      .rotateY(bearing)
      .translate(x, SITE.fence.height - height / 2, z)
  })
  const both = mergeGeometries(plates)
  for (const plate of plates) plate.dispose()
  return both
}

// The no-entry signs on the fence, one on each side of the gate, read from outside the site: the no-entry
// mark, « ACCÈS INTERDIT », and the name of who forbids it.
function NoEntrySigns() {
  const face = useCanvasTexture(FACE.width, FACE.height, drawNoEntry)
  const plates = useMemo(signPlates, [])
  useEffect(() => () => plates.dispose(), [plates])

  return (
    <mesh geometry={plates} castShadow receiveShadow>
      <meshStandardMaterial
        map={face}
        roughness={0.65}
        emissive="#ffffff"
        emissiveMap={face}
        emissiveIntensity={SIGN.shine}
      />
    </mesh>
  )
}

// What is painted on the site itself is one sheet of paint, in pixels: the hall's name, under it the tank's
// pictogram, and beside that a patch of the paint of the ground marking.
const SHEET = { width: 1000, height: 800 } as const
const PATCHES = {
  name: { x: 0, y: 0, width: 1000, height: 400 },
  gas: { x: 0, y: 400, width: 680, height: 400 },
  hatch: { x: 760, y: 500, width: 200, height: 200 },
} as const
type Patch = (typeof PATCHES)[keyof typeof PATCHES]

// Draws a patch of the sheet in a frame of its own, from its top left corner.
function drawPatch(
  context: CanvasRenderingContext2D,
  { x, y, width, height }: Patch,
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  context.save()
  context.translate(x, y)
  draw(context, width, height)
  context.restore()
}

// Lays a shape's own texture coordinates, 0–1 across it, over a patch of the sheet.
function onPatch(shape: BufferGeometry, { x, y, width, height }: Patch): BufferGeometry {
  const uv = shape.getAttribute('uv')
  for (let point = 0; point < uv.count; point++) {
    uv.setXY(
      point,
      (x + uv.getX(point) * width) / SHEET.width,
      1 - (y + (1 - uv.getY(point)) * height) / SHEET.height,
    )
  }
  return shape
}

function drawName(context: CanvasRenderingContext2D, width: number) {
  const middle = width / 2
  context.fillStyle = INK
  context.textAlign = 'center'
  context.font = `800 160px ${SANS}`
  context.fillText(WORDS.owner, middle, 180, width - 60)
  context.fillRect(60, 228, width - 120, 8)
  context.font = `600 92px ${MONO}`
  context.letterSpacing = '14px'
  context.fillText(WORDS.outpost, middle, 348, width - 60)
}

// The site's name on the generator hall, « AetherCorp » and the Outpost's number: a sheet on the wall the site
// plan gives it.
function nameSheet(): BufferGeometry {
  const { x, z, bearing } = hallSign()
  const { width, height, foot } = SITE.signs.hall

  return new PlaneGeometry(width, height)
    .rotateY(bearing)
    .translate(x + PAINT * Math.sin(bearing), foot + height / 2, z + PAINT * Math.cos(bearing))
}

// A flame, in a box 100 across, and what is hollowed out of its foot.
const FLAME =
  'M50 4 C56 30 86 44 86 70 C86 90 68 100 50 100 C32 100 14 90 14 70 ' +
  'C14 56 24 46 31 36 C33 48 39 53 45 50 C40 36 42 18 50 4 Z'
const FLAME_HEART = 'M50 62 C58 72 63 79 63 86 C63 94 57 98 50 98 C43 98 37 94 37 86 C37 79 42 72 50 62 Z'

function drawGas(context: CanvasRenderingContext2D, width: number, height: number) {
  const middle = height / 2
  // The hazard diamond, on the left, as tall as the patch.
  const reach = middle - 24
  context.strokeStyle = INK
  context.lineWidth = 20
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(middle, middle - reach)
  context.lineTo(middle + reach, middle)
  context.lineTo(middle, middle + reach)
  context.lineTo(middle - reach, middle)
  context.closePath()
  context.stroke()
  context.fillStyle = INK
  context.font = `800 140px ${SANS}`
  context.textBaseline = 'middle'
  context.fillText(WORDS.gas, height + 4, middle + 8, width - height - 20)
  context.translate(middle - 85, middle - 96)
  context.scale(1.7, 1.7)
  context.fill(new Path2D(FLAME))
  context.globalCompositeOperation = 'destination-out'
  context.fill(new Path2D(FLAME_HEART))
}

// How far above the level the pictogram's middle is, round the barrel, in radians: turned up to whoever
// looks down at the maquette.
const TILT = 0.5

// The gas pictogram on the tank, a flame in a hazard diamond and « GAZ »: a sheet bent round the tank's
// barrel, which lies along x. Its width runs along the barrel, its middle is `TILT` above the level, on the
// side the site plan says.
function gasSheet(): BufferGeometry {
  const { tank, signs } = SITE
  const radius = tank.depth / 2 + PAINT
  const sheet = new PlaneGeometry(signs.tank.width, signs.tank.height, 1, 16)
  const points = sheet.getAttribute('position')
  for (let point = 0; point < points.count; point++) {
    const angle = TILT + points.getY(point) / radius
    points.setXYZ(point, points.getX(point), radius * Math.sin(angle), radius * Math.cos(angle))
  }
  sheet.computeVertexNormals()
  // Round the barrel's axis.
  return sheet.rotateY(signs.tank.bearing).translate(tank.x, tank.height - tank.depth / 2, tank.z)
}

// The danger zone's stripes: how far apart they are along x, each half that wide, and how much of the ground
// under them their paint covers. Worn thin, in the fence's steel: less than the haze that lies over it.
const HATCH = { pace: 0.14, cover: 0.55 } as const

type Spot = readonly [x: number, z: number]

// What a convex outline on the ground keeps on one side of the line x + z = `at`: beyond it (`keep` 1) or
// short of it (-1).
function cut(outline: readonly Spot[], at: number, keep: 1 | -1): Spot[] {
  const beyond = ([x, z]: Spot) => keep * (x + z - at)

  return outline.flatMap((from, index) => {
    const to = outline[(index + 1) % outline.length] ?? from
    const [here, there] = [beyond(from), beyond(to)]
    const share = here / (here - there)
    const crossing: Spot[] =
      here * there < 0 ? [[from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share]] : []
    return here >= 0 ? [from, ...crossing] : crossing
  })
}

// The danger zone around the gas tank: a hatched band on the ground, `band` wide just inside the zone's edge,
// the tank and clear ground inside it. Its stripes run at 45° and meet at its corners: each is what a side of
// the band keeps of a strip of ground between two lines x + z = constant. All of them read the one patch of
// paint.
function hatchSheet(): BufferGeometry {
  const { x, z, width, depth } = dangerZone()
  const { band } = SITE.signs.dangerZone
  const [left, right, back, front] = [x - width / 2, x + width / 2, z - depth / 2, z + depth / 2]
  // The front and the back from corner to corner, the two sides between them.
  const sides = [
    [left, right, front - band, front],
    [left, right, back, back + band],
    [left, left + band, back + band, front - band],
    [right - band, right, back + band, front - band],
  ] as const
  const { pace } = HATCH
  const positions: number[] = []
  for (const [x0, x1, z0, z1] of sides) {
    // Its corners, in the order that looks up.
    const side: Spot[] = [
      [x0, z0],
      [x0, z1],
      [x1, z1],
      [x1, z0],
    ]
    for (let stripe = Math.floor((x0 + z0) / pace); stripe * pace < x1 + z1; stripe++) {
      const [first, ...others] = cut(cut(side, stripe * pace, 1), (stripe + 0.5) * pace, -1)
      if (!first) continue
      // A fan of triangles round its first corner.
      others.slice(1).forEach((corner, index) => {
        for (const [cornerX, cornerZ] of [first, others[index] ?? corner, corner]) {
          positions.push(cornerX, PAINT, cornerZ)
        }
      })
    }
  }
  const count = positions.length / 3
  const sheet = new BufferGeometry()
  sheet.setAttribute('position', new Float32BufferAttribute(positions, 3))
  sheet.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: count }, () => [0, 1, 0]).flat(), 3))
  // Every point reads the middle of its patch.
  sheet.setAttribute('uv', new Float32BufferAttribute(Array.from({ length: count }, () => [0.5, 0.5]).flat(), 2))
  return sheet
}

// Everything painted on the site as one shape: the hall's name, the tank's pictogram and the danger zone's
// stripes, each reading its patch of the sheet.
function paintwork(): BufferGeometry {
  const sheets = [
    onPatch(nameSheet(), PATCHES.name).toNonIndexed(),
    onPatch(gasSheet(), PATCHES.gas).toNonIndexed(),
    onPatch(hatchSheet(), PATCHES.hatch),
  ]
  const all = mergeGeometries(sheets)
  for (const sheet of sheets) sheet.dispose()
  return all
}

// What is painted on the site: « AetherCorp » and the Outpost's number on the generator hall, a gas pictogram
// on the tank, and the danger zone marked on the ground around it. Lit paint: it does not glow, and the haze
// of a gas leak is drawn over it.
function Paintwork() {
  const sheet = useCanvasTexture(SHEET.width, SHEET.height, (context) => {
    drawPatch(context, PATCHES.name, drawName)
    drawPatch(context, PATCHES.gas, drawGas)
    drawPatch(context, PATCHES.hatch, (patch, width, height) => {
      patch.globalAlpha = HATCH.cover
      patch.fillStyle = STEEL
      patch.fillRect(0, 0, width, height)
    })
  })
  const painted = useMemo(paintwork, [])
  useEffect(() => () => painted.dispose(), [painted])

  return (
    // Under what else is drawn on the ground, and under the haze.
    <mesh geometry={painted} renderOrder={1} receiveShadow>
      <meshStandardMaterial map={sheet} roughness={0.7} transparent depthWrite={false} />
    </mesh>
  )
}

// The signage of a sensitive site, where the site plan puts it: a no-entry sign on the fence on each side
// of the gate, the danger zone marked on the ground around the gas tank and a gas pictogram on the tank, the
// site's name on the generator hall. All of it is drawn in code, in the maquette's neutral tones, and none of
// it moves or reacts to the feed. It is two shapes in all, the signs and the paint: two draws a frame, however
// much it says.
export const Signage = memo(function Signage() {
  return (
    <group>
      <NoEntrySigns />
      <Paintwork />
    </group>
  )
})

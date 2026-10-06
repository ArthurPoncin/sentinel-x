import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture, type Sprite, type SpriteMaterial, SRGBColorSpace } from 'three'

// A texture drawn in code on a 2D canvas: the LCD's screen, the engraving, the mic grille, a label's card.
export function useCanvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const created = new CanvasTexture(canvas)
    created.colorSpace = SRGBColorSpace
    created.anisotropy = 8
    return created
  }, [width, height])

  useEffect(() => {
    const context = (texture.image as HTMLCanvasElement).getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    draw(context)
    texture.needsUpdate = true
  })

  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

// A label's card, in pixels.
const CARD = { width: 640, height: 128 } as const
// How tall a card is for its width.
export const CARD_RATIO = CARD.height / CARD.width
// The point of the card that stands where it is put: its middle, or the middle of its lower edge.
const ANCHORS = { middle: [0.5, 0.5], foot: [0.5, 0] } as const

export interface LabelCardProps {
  // What it reads, or null: it has nothing to say, and keeps its last text while it fades out.
  text: string | null
  // The color of its text and of its edge.
  color: string
  // How wide it is, in the units of what it hangs in.
  width: number
  position?: readonly [x: number, y: number, z: number]
  anchor?: keyof typeof ANCHORS
  // How much of it shows right now, 0–1: asked on every frame.
  shown: () => number
}

// What the Twin says of a signal in words: a line of text on a dark card edged in the signal's color. A
// sprite: it faces the camera wherever the orbit takes it, and is drawn over whatever stands in front of it,
// so it reads from every side.
export function LabelCard({ text, color, width, position, anchor = 'middle', shown }: LabelCardProps) {
  const sprite = useRef<Sprite>(null)
  const material = useRef<SpriteMaterial>(null)
  const [written, setWritten] = useState(text ?? '')
  if (text !== null && text !== written) setWritten(text)

  const card = useCanvasTexture(CARD.width, CARD.height, (context) => {
    const { width, height } = CARD
    const inset = 6
    context.beginPath()
    context.roundRect(inset, inset, width - 2 * inset, height - 2 * inset, (height - 2 * inset) / 2)
    context.fillStyle = 'rgba(8, 10, 13, 0.86)'
    context.fill()
    context.lineWidth = 5
    context.strokeStyle = color
    context.stroke()
    context.fillStyle = color
    context.font = '700 58px ui-monospace, Menlo, Consolas, monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(written, width / 2, height / 2 + 2, width - 80)
  })

  useFrame(() => {
    const level = shown()
    if (material.current) material.current.opacity = level
    // Nothing to draw once it has faded out.
    if (sprite.current) sprite.current.visible = level > 0.004
  })

  return (
    <sprite
      ref={sprite}
      position={position}
      center={ANCHORS[anchor]}
      scale={[width, width * CARD_RATIO, 1]}
      renderOrder={10}
      visible={false}
    >
      <spriteMaterial ref={material} map={card} transparent opacity={0} depthTest={false} toneMapped={false} />
    </sprite>
  )
}

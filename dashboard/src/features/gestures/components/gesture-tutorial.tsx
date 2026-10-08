import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import type { Hand } from '../api/hand-frame'
import { type LiveHands, useHandActions, useHandState, useHandSwitch, useLiveHands } from '../hooks/use-hand-control'
import { completed, doing, LESSONS, type Lesson, type LessonId, lessonOf } from '../utils/lessons'
import { flat, handLines, type View } from '../utils/skeleton'
import { DEAD_ZONE, NEUTRAL } from '../utils/steer'
import { handLine } from './hand-hud'

// What the hands are drawn in, the sensor under them, and the place a flat hand rests at.
const INK = { hand: '#9fdcff', sensor: '#5b6b7c', rest: 'rgb(159 220 255 / 35%)' } as const
// The hand sensor's own footprint, in millimetres: 80 across, 30 deep, 11 high.
const SENSOR = { width: 80, depth: 30, height: 11 } as const

// What a view of the space over the sensor shows, in millimetres, as a screen counts: x to the right, y down.
interface Frame {
  view: View
  title: string
  left: number
  top: number
  width: number
  height: number
}
const FRAMES: readonly Frame[] = [
  { view: 'top', title: 'Vue de dessus', left: -260, top: -230, width: 520, height: 420 },
  { view: 'front', title: 'Vue de face', left: -260, top: -400, width: 520, height: 420 },
]
// Canvas pixels for a millimetre.
const SHARP = 2

// One view of the hands over the sensor, drawn again on every frame the screen shows: the sensor, the place a
// flat hand rests at, and the hands as the sensor sees them at that instant.
function drawHands(context: CanvasRenderingContext2D, { view, left, top, width, height }: Frame, hands: readonly Hand[]) {
  context.setTransform(SHARP, 0, 0, SHARP, -left * SHARP, -top * SHARP)
  context.clearRect(left, top, width, height)
  context.lineCap = 'round'

  context.fillStyle = INK.sensor
  if (view === 'top') context.fillRect(-SENSOR.width / 2, -SENSOR.depth / 2, SENSOR.width, SENSOR.depth)
  else context.fillRect(-SENSOR.width / 2, -SENSOR.height, SENSOR.width, SENSOR.height)
  // Where a flat hand moves nothing: around the rest, above the sensor.
  const [restX, restY] = flat(NEUTRAL, view)
  context.strokeStyle = INK.rest
  context.lineWidth = 1.5
  context.setLineDash([6, 6])
  context.beginPath()
  context.arc(restX, restY, DEAD_ZONE, 0, 2 * Math.PI)
  context.stroke()
  context.setLineDash([])

  context.strokeStyle = INK.hand
  context.fillStyle = INK.hand
  context.lineWidth = 6
  for (const hand of hands) {
    context.beginPath()
    for (const [from, to] of handLines(hand)) {
      context.moveTo(...flat(from, view))
      context.lineTo(...flat(to, view))
    }
    context.stroke()
    for (const { joints } of hand.fingers) {
      for (const joint of joints.slice(1)) {
        const [x, y] = flat(joint, view)
        context.beginPath()
        context.arc(x, y, 6, 0, 2 * Math.PI)
        context.fill()
      }
    }
  }
}

// The hands as the sensor sees them, from above and from the front, and under them what they do at this
// instant. Drawn on every frame without a render in between: the hands move a hundred times a second.
function HandScope({ live }: { live: LiveHands }) {
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  const line = useRef<HTMLParagraphElement>(null)
  const pose = useHandState((state) => state.pose)
  const said = useRef(pose)
  useEffect(() => {
    said.current = pose
  })

  useEffect(() => {
    let frame = requestAnimationFrame(function draw() {
      const hands = live.hands()
      FRAMES.forEach((shown, index) => {
        const context = canvases.current[index]?.getContext('2d')
        if (context) drawHands(context, shown, hands)
      })
      const words = hands.length > 0 ? doing(said.current, live.reading()) : 'Aucune main au-dessus du capteur'
      if (line.current && line.current.textContent !== words) line.current.textContent = words
      frame = requestAnimationFrame(draw)
    })
    return () => cancelAnimationFrame(frame)
  }, [live])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {FRAMES.map((shown, index) => (
          <figure key={shown.view} className="m-0 overflow-hidden rounded-lg border bg-black/40">
            <canvas
              ref={(canvas) => {
                canvases.current[index] = canvas
              }}
              width={shown.width * SHARP}
              height={shown.height * SHARP}
              className="block h-auto w-full"
              role="img"
              aria-label={`${shown.title} des mains au-dessus du capteur`}
            />
            <figcaption className="border-t px-3 py-1.5 text-xs tracking-wide text-muted-foreground uppercase">{shown.title}</figcaption>
          </figure>
        ))}
      </div>
      <p ref={line} className="m-0 min-h-6 font-mono text-sm" role="status" />
    </div>
  )
}

// The hand a lesson shows, as lines: the same bones as the live view draws, in the pose to take.
function HandSketch({ hands, view }: Pick<Lesson, 'hands' | 'view'>) {
  const drawn = useMemo(() => {
    const lines = hands.flatMap((hand) => handLines(hand).map(([from, to]) => [flat(from, view), flat(to, view)] as const))
    const points = lines.flat()
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const pad = 22
    const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad]
    return { lines, box: box.join(' ') }
  }, [hands, view])

  if (hands.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-5xl font-bold text-muted-foreground" aria-hidden="true">
        ?
      </div>
    )
  }
  return (
    <svg viewBox={drawn.box} className="h-32 w-full" role="img" aria-label="Position de la main">
      {drawn.lines.map(([[x1, y1], [x2, y2]], index) => (
        // A fixed set of bones, told apart by their place in it.
        <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
      ))}
    </svg>
  )
}

const VIEWS: Readonly<Record<View, string>> = { top: 'vue de dessus', front: 'vue de face', side: 'vue de côté' }

// One gesture: the hand to make, how, and what it does. Lit while the hand is in it, marked once it was made.
function LessonCard({ lesson, active, done }: { lesson: Lesson; active: boolean; done: boolean }) {
  const found = done && lesson.secret ? lesson.secret : lesson
  return (
    <Card data-active={active || undefined} className="gap-3 py-4 transition-colors data-active:border-[#9fdcff] data-active:bg-[#9fdcff]/5">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {found.title}
          {done ? <Badge className="bg-(--nominal) text-black">Réussi</Badge> : <Badge variant="outline">À essayer</Badge>}
        </CardTitle>
        <CardDescription>{found.how}</CardDescription>
      </CardHeader>
      <CardContent className={`px-4 ${active ? 'text-[#9fdcff]' : 'text-muted-foreground'}`}>
        <HandSketch hands={found.hands} view={lesson.view} />
        {found.hands.length > 0 && <p className="m-0 text-center text-xs tracking-wide uppercase">{VIEWS[lesson.view]}</p>}
        <p className="mt-3 mb-0 text-sm text-foreground">{found.does}</p>
      </CardContent>
    </Card>
  )
}

// The hand control's tutorial: the Operator's hands as the sensor sees them, what they do at this instant, and
// every gesture the dashboard answers to, each with the hand to make. A gesture made is marked, for as long as
// the page stays open. Here a gesture is only shown: whoever acts on them leaves the Alarm and the screen alone
// while this page is the one open.
export function GestureTutorial() {
  const { enabled, setEnabled } = useHandSwitch()
  const live = useLiveHands()
  const bridge = useHandState((state) => state.bridge)
  const tracking = useHandState((state) => state.tracking)
  const present = useHandState((state) => state.present)
  const pose = useHandState((state) => state.pose)
  const [done, setDone] = useState<ReadonlySet<LessonId>>(() => new Set())
  const mark = useCallback((lessons: readonly LessonId[]) => {
    setDone((before) => (lessons.every((lesson) => before.has(lesson)) ? before : new Set([...before, ...lessons])))
  }, [])

  useEffect(() => mark(completed({ pose, action: null, shot: false })), [pose, mark])
  useHandActions((action) => mark(completed({ pose: 'none', action, shot: false })))
  // A shot is told by its time: one fired before the page was opened is not this page's.
  useEffect(() => {
    if (!live) return
    let last = live.reading().shot?.at ?? null
    const timer = setInterval(() => {
      const at = live.reading().shot?.at ?? null
      if (at !== null && at !== last) mark(completed({ pose: 'none', action: null, shot: true }))
      last = at ?? last
    }, 100)
    return () => clearInterval(timer)
  }, [live, mark])

  if (!enabled || !live) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Tutoriel des gestes</CardTitle>
          <CardDescription>
            La commande gestuelle est désactivée. Activez-la avec un capteur de main sur le bureau pour suivre le tutoriel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setEnabled(true)}>Activer la commande gestuelle</Button>
        </CardContent>
      </Card>
    )
  }

  const on = lessonOf(pose)
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold">Tutoriel des gestes</h1>
          <p className="m-0 mt-1 max-w-prose text-muted-foreground">
            Passez la main au-dessus du capteur et essayez chaque geste. Ici rien n'est envoyé : ni la sirène ni
            l'écran ne changent.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {done.size} / {LESSONS.length} gestes réussis
        </Badge>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5 lg:gap-6">
        <Card className="lg:sticky lg:top-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Vos mains, vues par le capteur</CardTitle>
            <CardDescription>{handLine({ bridge, tracking, present, pose, confirming: null })}</CardDescription>
          </CardHeader>
          <CardContent>
            <HandScope live={live} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3">
          {LESSONS.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} active={on === lesson.id} done={done.has(lesson.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}

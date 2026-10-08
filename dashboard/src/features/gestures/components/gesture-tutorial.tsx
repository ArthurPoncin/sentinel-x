import { Check } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { type LiveHands, useHandActions, useHandState, useHandSwitch, useLiveHands } from '../hooks/use-hand-control'
import type { Shown } from '../utils/demo'
import type { Viewpoint } from '../utils/hologram'
import { completed, doing, LESSONS, type Lesson, type LessonId, lessonOf } from '../utils/lessons'
import type { Pose } from '../utils/pose'
import { HandHologram } from './hand-hologram'
import { handLine } from './hand-hud'

// Whether the Operator asked their machine for no motion: what the page plays by itself then stands still.
const NO_MOTION = '(prefers-reduced-motion: reduce)'
function useStill(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const media = window.matchMedia(NO_MOTION)
      media.addEventListener('change', changed)
      return () => media.removeEventListener('change', changed)
    },
    () => window.matchMedia(NO_MOTION).matches,
  )
}

// The live hands are seen as the Operator sees their own: from their side of the desk, a little above.
const OPERATOR: Viewpoint = { yaw: 0, pitch: 0.5 }
// Seconds a shot stays lit over the live hands.
const SHOT_LIT = 0.4

// The pose the hands are in, in two words, for the corner of their view.
const POSES: Readonly<Record<Pose, string>> = {
  flat: 'Main à plat',
  spread: 'Deux mains',
  fist: 'Poing fermé',
  edge: 'Sur la tranche',
  'thumb-up': 'Pouce levé',
  'thumb-down': 'Pouce baissé',
  aim: 'Index pointé',
  none: 'Aucune pose',
}

// The hands as the sensor sees them, in a hologram over the desk, and under them what they do at this instant.
// Drawn on every frame without a render in between: the hands move a hundred times a second.
function HandScope({ live, still }: { live: LiveHands; still: boolean }) {
  const line = useRef<HTMLParagraphElement>(null)
  const pose = useHandState((state) => state.pose)
  const present = useHandState((state) => state.present)
  const said = useRef(pose)
  useEffect(() => {
    said.current = pose
  })

  const show = useCallback(
    (seconds: number): Shown => {
      const hands = live.hands()
      const reading = live.reading()
      const words = hands.length > 0 ? doing(said.current, reading) : 'Aucune main au-dessus du capteur'
      if (line.current && line.current.textContent !== words) line.current.textContent = words
      const flash = reading.shot ? Math.max(0, 1 - (seconds - reading.shot.at) / SHOT_LIT) : 0
      return { hands, hold: reading.confirming?.progress ?? null, flash }
    },
    [live],
  )

  return (
    <div className="hologram aspect-[4/3] rounded-lg">
      <HandHologram show={show} from={OPERATOR} stage still={still} label="Vos mains au-dessus du capteur" className="absolute inset-0 size-full" />
      <div className="absolute inset-x-3 top-3 z-2 flex items-center justify-between gap-2 font-mono text-[0.7rem] tracking-widest text-[#9fdcff] uppercase">
        <span className="flex items-center gap-2">
          <span data-live={present || undefined} className="size-2 rounded-full bg-[#9fdcff]/40 data-live:animate-pulse data-live:bg-[#9fdcff] data-live:shadow-[0_0_8px_#2f9bff]" />
          {present ? 'Main suivie' : 'En attente'}
        </span>
        <span>{present ? POSES[pose] : ''}</span>
      </div>
      <p ref={line} className="absolute inset-x-3 bottom-3 z-2 m-0 min-h-5 text-center font-mono text-sm text-[#eaf7ff] [text-shadow:0_0_10px_#2f9bff]" role="status" />
    </div>
  )
}

// One gesture: the hand that plays it, how to make it, and what it does. Lit while the hand is in it, marked once
// it was made.
function LessonCard({ lesson, step, active, done, still }: { lesson: Lesson; step: number; active: boolean; done: boolean; still: boolean }) {
  const found = done && lesson.secret ? lesson.secret : lesson
  const untold = lesson.secret !== undefined && !done
  return (
    <Card
      data-active={active || undefined}
      data-done={done || undefined}
      className="gap-0 overflow-hidden py-0 transition-[border-color,box-shadow] duration-300 data-active:border-[#9fdcff]/70 data-active:shadow-[0_0_28px_rgb(47_155_255/28%)]"
    >
      <div className="hologram h-44 border-x-0 border-t-0">
        {untold ? (
          <div className="flex size-full items-center justify-center text-6xl font-bold text-[#9fdcff]/70 [text-shadow:0_0_24px_#2f9bff]" aria-hidden="true">
            ?
          </div>
        ) : (
          <HandHologram show={found.demo} from={lesson.from} still={still} label={`Le geste : ${found.title}`} className="absolute inset-0 size-full" />
        )}
        <span className="absolute top-2.5 left-3 z-2 font-mono text-xs tracking-widest text-[#9fdcff]/70">{String(step).padStart(2, '0')}</span>
        {done ? (
          <Badge className="absolute top-2 right-2 z-2 gap-1 bg-(--nominal) text-black">
            <Check aria-hidden="true" />
            Réussi
          </Badge>
        ) : (
          <Badge variant="outline" className="absolute top-2 right-2 z-2 border-[#9fdcff]/30 bg-black/30 text-[#9fdcff]">
            {active ? 'En cours' : 'À essayer'}
          </Badge>
        )}
      </div>
      <CardHeader className="px-4 pt-4">
        <CardTitle className="text-base">{found.title}</CardTitle>
        <CardDescription>{found.how}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 pt-3 pb-4">
        <p className="m-0 border-t pt-3 text-sm">{found.does}</p>
      </CardContent>
    </Card>
  )
}

// The hand control's tutorial: the Operator's hands as the sensor sees them, what they do at this instant, and
// every gesture the dashboard answers to, each played by a hand of light. A gesture made is marked, for as long as
// the page stays open. Here a gesture is only shown: whoever acts on them leaves the Alarm and the screen alone
// while this page is the one open.
export function GestureTutorial() {
  const { enabled, setEnabled } = useHandSwitch()
  const live = useLiveHands()
  const bridge = useHandState((state) => state.bridge)
  const tracking = useHandState((state) => state.tracking)
  const present = useHandState((state) => state.present)
  const pose = useHandState((state) => state.pose)
  const still = useStill()
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="m-0 font-mono text-xs tracking-widest text-[#9fdcff] uppercase">Commande gestuelle</p>
          <h1 className="m-0 mt-1 text-2xl font-semibold">Tutoriel des gestes</h1>
          <p className="m-0 mt-1 max-w-prose text-muted-foreground">
            Passez la main au-dessus du capteur et essayez chaque geste. Ici rien n'est envoyé : ni la sirène ni
            l'écran ne changent.
          </p>
        </div>
        <div className="min-w-48">
          <p className="m-0 flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
            Gestes réussis
            <span className="font-mono text-lg text-foreground">
              {done.size} / {LESSONS.length}
            </span>
          </p>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#9fdcff]/15"
            role="progressbar"
            aria-label="Gestes réussis"
            aria-valuemin={0}
            aria-valuemax={LESSONS.length}
            aria-valuenow={done.size}
          >
            <div
              className="h-full rounded-full bg-[#9fdcff] shadow-[0_0_10px_#2f9bff] transition-[width] duration-500"
              style={{ width: `${(done.size / LESSONS.length) * 100}%` }}
            />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5 lg:gap-6">
        <Card className="lg:sticky lg:top-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Vos mains, vues par le capteur</CardTitle>
            <CardDescription>{handLine({ bridge, tracking, present, pose, confirming: null })}</CardDescription>
          </CardHeader>
          <CardContent>
            <HandScope live={live} still={still} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3">
          {LESSONS.map((lesson, index) => (
            <LessonCard key={lesson.id} lesson={lesson} step={index + 1} active={on === lesson.id} done={done.has(lesson.id)} still={still} />
          ))}
        </div>
      </div>
    </div>
  )
}

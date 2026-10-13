import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { useVoiceState, useVoiceSwitch } from '../hooks/use-voice-control'
import type { VoiceState } from '../stores/voice-store'
import { WAKE_WINDOW } from '../utils/interpret'
import { CHAPTERS, completed, LESSONS, type Lesson, type LessonId } from '../utils/lessons'
import { failureLine, lastLine, statusLine } from '../utils/lines'

// What to do while the ear is not listening yet, by where it is.
const TO_DO: Readonly<Partial<Record<VoiceState['status'], string>>> = {
  waiting: "Fermez l'autre onglet du dashboard, ou essayez les commandes depuis celui-là.",
  asking: 'Le navigateur demande le micro : autorisez-le pour ce site.',
  loading: 'Quelques secondes la première fois, puis le modèle reste dans le navigateur.',
}

// One command: each way of saying it, and what it does. Marked once it was said.
function LessonCard({ lesson, step, active, done }: { lesson: Lesson; step: number; active: boolean; done: boolean }) {
  return (
    <Card
      data-active={active || undefined}
      data-done={done || undefined}
      className="gap-0 py-0 transition-[border-color,box-shadow] duration-300 data-active:border-[#9fdcff]/70 data-active:shadow-[0_0_28px_rgb(47_155_255/28%)]"
    >
      <CardHeader className="px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs tracking-widest text-[#9fdcff]/70">{String(step).padStart(2, '0')}</span>
          {done ? (
            <Badge className="gap-1 bg-(--nominal) text-black">
              <Check aria-hidden="true" />
              Réussi
            </Badge>
          ) : (
            <Badge variant="outline" className="border-[#9fdcff]/30 text-[#9fdcff]">
              {active ? 'En cours' : 'À essayer'}
            </Badge>
          )}
        </div>
        <CardTitle className="text-base">{lesson.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-3 pb-4">
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Formulations">
          {lesson.wordings.map((wording) => (
            <li key={wording} className="rounded-md border border-[#9fdcff]/25 bg-[#9fdcff]/8 px-2 py-0.5 font-mono text-sm">
              « {wording} »
            </li>
          ))}
        </ul>
        <p className="m-0 mt-3 border-t pt-3 text-sm text-muted-foreground">{lesson.does}</p>
      </CardContent>
    </Card>
  )
}

// The voice control's tutorial: where the ear is, what it made of the last sentence, and every command the
// dashboard answers to, each with its wordings. A command said is marked, for as long as the page stays open.
// Here a command is only tried: whoever acts on them sends nothing and leaves the screen alone while this page
// is the one open.
export function VoiceTutorial() {
  const { enabled, setEnabled, failure } = useVoiceSwitch()
  const status = useVoiceState((state) => state.status)
  const last = useVoiceState((state) => state.last)
  // A sentence said before the page was opened is not this page's: the one that led here, for one.
  const [opened] = useState(last)
  const [done, setDone] = useState<ReadonlySet<LessonId>>(() => new Set())

  useEffect(() => {
    if (!last || last === opened) return
    const lessons = completed(last.outcome)
    setDone((before) => (lessons.every((lesson) => before.has(lesson)) ? before : new Set([...before, ...lessons])))
  }, [last, opened])

  if (!enabled) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Tutoriel de la voix</CardTitle>
          <CardDescription>
            {failure
              ? `La commande vocale s'est désactivée. ${failureLine(failure)}`
              : "La commande vocale est désactivée. Activez-la, puis autorisez le micro quand le navigateur le demande : rien n'est écouté avant."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setEnabled(true)}>{failure ? 'Réactiver la commande vocale' : 'Activer la commande vocale'}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="m-0 font-mono text-xs tracking-widest text-[#9fdcff] uppercase">Commande vocale</p>
          <h1 className="m-0 mt-1 text-2xl font-semibold">Tutoriel de la voix</h1>
          <p className="m-0 mt-1 max-w-prose text-muted-foreground">
            Dites « Sentinelle », puis la commande, dans la même phrase ou dans les {WAKE_WINDOW} secondes. Ici rien
            n'est envoyé : ni la sirène ni l'écran ne changent.
          </p>
        </div>
        <div className="min-w-48">
          <p className="m-0 flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
            Commandes réussies
            <span className="font-mono text-lg text-foreground">
              {done.size} / {LESSONS.length}
            </span>
          </p>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#9fdcff]/15"
            role="progressbar"
            aria-label="Commandes réussies"
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
            <CardTitle>Ce que le dashboard entend</CardTitle>
            <CardDescription>{status === 'off' ? 'Ouverture du micro…' : statusLine(status)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {TO_DO[status] && <p className="m-0">{TO_DO[status]}</p>}
            <p className="m-0 min-h-10 rounded-md border border-[#9fdcff]/25 bg-[#9fdcff]/8 px-3 py-2 font-mono">
              {last && last !== opened ? lastLine(last) : 'Aucune phrase entendue sur cet écran.'}
            </p>
            <p className="m-0 text-muted-foreground">
              Une phrase sans « Sentinelle » n'est pas prise. Une commande mal entendue n'est pas prise non plus :
              répétez-la, plus près du micro.
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-3 lg:gap-6">
          {CHAPTERS.map((chapter) => (
            <section key={chapter.title} className="flex flex-col gap-3" aria-label={chapter.title}>
              <div>
                <h2 className="m-0 text-lg font-semibold">{chapter.title}</h2>
                {chapter.how && <p className="m-0 text-sm text-muted-foreground">{chapter.how}</p>}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {chapter.lessons.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={lesson}
                    step={LESSONS.indexOf(lesson) + 1}
                    // The wake word's lesson is under way while the ear is awake: a command is what comes next.
                    active={lesson.id === 'wake' && status === 'awake'}
                    done={done.has(lesson.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

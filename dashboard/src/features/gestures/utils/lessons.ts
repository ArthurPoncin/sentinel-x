import type { Hand } from '../api/hand-frame'
import type { Action, Reading } from './interpret'
import { modelHand } from './model-hand'
import type { Pose } from './pose'
import type { View } from './skeleton'

// The gestures the tutorial teaches, in the order it shows them: what to do with the hand, what the dashboard
// does about it, and the hand it draws beside the words.
export type LessonId = 'flat' | 'spread' | 'fist' | 'edge' | 'thumb-up' | 'thumb-down' | 'aim' | 'secret'

export interface Lesson {
  id: LessonId
  title: string
  // How to hold the hand, then what it does.
  how: string
  does: string
  // The hands drawn for it, and from where they are looked at.
  hands: readonly Hand[]
  view: View
  // Not told until the Operator has found it by themselves.
  secret?: { title: string; how: string; does: string; hands: readonly Hand[] }
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'flat',
    title: 'Main à plat',
    how: 'Paume vers le bas, à 20 cm au-dessus du capteur. Déplacez-la sur le côté, vers vous, vers le haut.',
    does: 'Pilote la caméra du Twin : tourne autour du site, incline, zoome. Au centre, rien ne bouge.',
    hands: [modelHand('flat')],
    view: 'top',
  },
  {
    id: 'spread',
    title: 'Deux mains ouvertes',
    how: 'Les deux mains au-dessus du capteur. Écartez-les, puis rapprochez-les.',
    does: 'Zoome et dézoome le Twin, comme deux doigts sur un écran.',
    hands: [modelHand('flat', { palm: [85, 200, 0] }), modelHand('flat', { palm: [-85, 200, 0], side: 'left', id: 2 })],
    view: 'top',
  },
  {
    id: 'fist',
    title: 'Poing fermé',
    how: 'Fermez la main au-dessus du capteur. Pendant un replay, portez-la à droite ou à gauche.',
    does: 'Tient la caméra où elle est. Pendant un replay, fait avancer ou reculer le temps.',
    hands: [modelHand('fist')],
    view: 'top',
  },
  {
    id: 'edge',
    title: 'Main sur la tranche, balayée',
    how: 'Main ouverte sur la tranche, pouce vers le haut. Balayez vivement au-dessus du capteur.',
    does: "Change d'écran, comme on tourne une page.",
    hands: [modelHand('edge')],
    view: 'side',
  },
  {
    id: 'thumb-up',
    title: 'Pouce levé, tenu 1,2 s',
    how: "Poing fermé, pouce vers le haut. Tenez jusqu'à ce que l'anneau soit plein.",
    does: 'Coupe la sirène du Sentinel.',
    hands: [modelHand('thumb-up')],
    view: 'front',
  },
  {
    id: 'thumb-down',
    title: 'Pouce baissé, tenu 1,2 s',
    how: "Poing fermé, pouce vers le bas. Tenez jusqu'à ce que l'anneau soit plein.",
    does: 'Déclenche la sirène du Sentinel.',
    hands: [modelHand('thumb-down')],
    view: 'front',
  },
  {
    id: 'aim',
    title: 'Index pointé',
    how: "Paume vers le bas, index tendu vers l'écran. Le bout du doigt déplace un viseur, comme une souris en l'air.",
    does: 'Sur le Twin, visez la cuve de gaz, le hall, le boîtier ou un intrus : une fiche dit ce que le système en sait.',
    hands: [modelHand('point')],
    view: 'top',
  },
  {
    id: 'secret',
    title: 'Geste secret',
    how: "Celui-là n'est écrit nulle part.",
    does: "Indice : l'intrus n'aime pas qu'on le montre du doigt.",
    hands: [],
    view: 'top',
    secret: {
      title: 'Pistolet',
      how: "Index pointé, pouce écarté : le chien est armé. Rabattez le pouce le long de l'index.",
      does: "Tire où est le viseur. Sur le Twin, l'intrus touché se désintègre, puis revient.",
      hands: [modelHand('point')],
    },
  },
]

// What the hands did since the tutorial was opened, as far as a lesson goes by it.
export interface Done {
  // The pose the hand is settled in, an action a gesture just asked for, whether a shot was just fired.
  pose: Pose
  action: Action | null
  shot: boolean
}

// The lessons what the hands just did completes.
export function completed({ pose, action, shot }: Done): LessonId[] {
  const lessons: LessonId[] = []
  if (pose === 'flat' || pose === 'spread' || pose === 'fist' || pose === 'aim') lessons.push(pose)
  if (action === 'page-left' || action === 'page-right') lessons.push('edge')
  if (action === 'all-clear') lessons.push('thumb-up')
  if (action === 'alarm') lessons.push('thumb-down')
  if (shot) lessons.push('secret')
  return lessons
}

// The lesson the hand is on right now, by its pose: the one the tutorial lights.
export function lessonOf(pose: Pose): LessonId | null {
  return pose === 'none' ? null : pose
}

const percent = (share: number) => `${Math.round(Math.abs(share) * 100)} %`

// What the hands do at this instant, in the Operator's words: what the tutorial reads under the hands it shows.
export function doing(pose: Pose, reading: Reading): string {
  if (pose === 'flat' && reading.steer) {
    const { turn, tilt, zoom } = reading.steer
    const moves = [
      turn !== 0 && `tourne à ${turn > 0 ? 'droite' : 'gauche'} ${percent(turn)}`,
      tilt !== 0 && `${tilt > 0 ? 'descend' : 'monte'} ${percent(tilt)}`,
      zoom !== 0 && `${zoom > 0 ? 'zoome' : 'dézoome'} ${percent(zoom)}`,
    ].filter(Boolean)
    return moves.length > 0 ? `Caméra : ${moves.join(' · ')}` : 'Caméra au repos : la main est au centre'
  }
  if (pose === 'spread') return reading.stretch === null ? 'Deux mains : prise en cours' : `Zoom × ${reading.stretch.toFixed(2)}`
  if (pose === 'fist') {
    if (!reading.wind) return 'Caméra tenue · replay à l’arrêt'
    return `Replay : ${reading.wind > 0 ? 'avance' : 'recule'} ${percent(reading.wind)}`
  }
  if (pose === 'edge') return 'Sur la tranche : balayez pour changer d’écran'
  if (reading.confirming) {
    const what = reading.confirming.pose === 'thumb-up' ? 'Couper la sirène' : 'Déclencher la sirène'
    return reading.confirming.progress >= 1 ? `${what} : geste reconnu` : `${what} : tenez encore, ${percent(reading.confirming.progress)}`
  }
  if (pose === 'aim' && reading.aim) {
    const across = reading.aim.x > 0.15 ? 'à droite' : reading.aim.x < -0.15 ? 'à gauche' : 'au centre'
    const up = reading.aim.y > 0.15 ? 'en haut' : reading.aim.y < -0.15 ? 'en bas' : 'à mi-hauteur'
    return `Viseur : ${across}, ${up}`
  }
  return 'Aucune pose reconnue'
}

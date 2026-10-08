import type { CSSProperties } from 'react'
import { useHandState, useHandSwitch } from '../hooks/use-hand-control'
import type { HandState } from '../stores/hand-store'
import { HOLD } from '../utils/interpret'
import type { Pose } from '../utils/pose'

// What each pose does, in the Operator's words.
const POSES: Readonly<Record<Pose, string>> = {
  flat: 'Main à plat · pilote la caméra du Twin',
  fist: 'Poing fermé · caméra tenue, déroule un replay',
  edge: "Main sur la tranche · balayez pour changer d'écran",
  'thumb-up': 'Pouce levé · maintenez pour couper la sirène',
  'thumb-down': 'Pouce baissé · maintenez pour déclencher la sirène',
  spread: 'Deux mains ouvertes · écartez pour zoomer, rapprochez pour dézoomer',
  // Not said: what an index does over the Twin is for whoever finds it.
  aim: 'Main détectée',
  none: 'Main détectée',
}

// What the hand control is up to, from the socket to the pose: the first thing that is missing is the one said.
export function handLine(state: HandState): string {
  if (state.bridge !== 'open') return 'Pont du capteur injoignable sur ce poste'
  if (!state.tracking) return 'En attente du capteur de main'
  if (!state.present) return 'Capteur prêt · approchez la main'
  return POSES[state.pose]
}

// In the top bar while the hand control is on: a line that says what the sensor sees and what the hand does,
// and a ring that fills while a thumb is held, in the color of what it is about to do. Nothing without it.
export function HandHud() {
  const { enabled } = useHandSwitch()
  const bridge = useHandState((state) => state.bridge)
  const tracking = useHandState((state) => state.tracking)
  const present = useHandState((state) => state.present)
  const pose = useHandState((state) => state.pose)
  const confirming = useHandState((state) => state.confirming?.pose ?? null)
  const fired = useHandState((state) => state.confirming?.fired ?? false)
  if (!enabled) return null

  const line = handLine({ bridge, tracking, present, pose, confirming: null })
  return (
    <div
      className="hand-hud"
      role="status"
      data-live={present}
      data-confirming={confirming ?? undefined}
      data-fired={fired || undefined}
      style={{ '--hold': `${HOLD}s` } as CSSProperties}
    >
      {confirming && (
        // Keyed by the thumb: turned over, the ring starts again from empty.
        <svg key={confirming} className="hand-hud-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" pathLength="1" />
        </svg>
      )}
      <span>{line}</span>
    </div>
  )
}

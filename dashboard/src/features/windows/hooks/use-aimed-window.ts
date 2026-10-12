import { useMemo, useRef, useState } from 'react'
import { type WindowRect, windowAt } from '../utils/aimed'
import { WINDOW_IDS, type WindowEvent, type WindowId } from '../utils/windows'

// What whoever draws the sight of a hand that aims asks of the windows, and tells them. Points are in pixels
// of the screen, as the windows' rectangles are.
export interface AimedWindows {
  // The window at a point, if any, and the rectangle it takes.
  at(x: number, y: number): WindowRect | null
  // Told, as often as the sight is drawn, which window it is on: null for none, and with no hand that aims.
  sighted(id: string | null): void
  // Told that a shot hit a window: it closes.
  shot(id: string): void
}

const isWindow = (id: string | null | undefined): id is WindowId => WINDOW_IDS.includes(id as WindowId)

// The open windows as they stand on screen at this instant, tilted and all: one that is fading out is gone.
function rects(): WindowRect[] {
  return [...document.querySelectorAll<HTMLElement>('.glass-window:not([data-leaving])')].flatMap((element) => {
    const id = element.dataset.window
    if (!isWindow(id)) return []
    const { left, top, right, bottom } = element.getBoundingClientRect()
    return [{ id, left, top, right, bottom }]
  })
}

// The windows under a hand: the one its sight is on, for the windows to light it, and what to hand whoever
// draws the sight. A shot on a window sends the same `close` as its button, said to be by a shot.
export function useAimedWindow(send: (event: WindowEvent) => void): [WindowId | null, AimedWindows] {
  const [aimed, setAimed] = useState<WindowId | null>(null)
  // What was last told, without waiting for the next render: the sight tells it on every frame.
  const told = useRef<WindowId | null>(null)

  const hand = useMemo<AimedWindows>(
    () => ({
      at: (x, y) => windowAt(rects(), x, y),
      sighted(id) {
        const next = isWindow(id) ? id : null
        if (next === told.current) return
        told.current = next
        setAimed(next)
      },
      shot(id) {
        if (isWindow(id)) send({ type: 'close', id, by: 'shot' })
      },
    }),
    [send],
  )

  return [aimed, hand]
}

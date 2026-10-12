import { type ReactNode, useCallback, useState } from 'react'
import {
  isOpen,
  type OpenWindow,
  SIDES,
  SLOT_PLACE,
  SLOTS,
  WINDOW_IDS,
  WINDOWS,
  type WindowEvent,
  type WindowId,
  type Windows,
} from '../utils/windows'

export interface GlassWindowsProps {
  windows: Windows
  // Where what the Operator does goes: the same events as from anywhere else.
  send: (event: WindowEvent) => void
  // What each window shows: whoever lays the windows over a screen brings it.
  content: Record<WindowId, ReactNode>
  // The window the sight of a hand that aims is on: it lights up.
  aimed?: WindowId | null
  // The windows a shot closed: they scatter in light as they go.
  shot?: readonly WindowId[]
}

const toggleId = (id: WindowId) => `window-toggle-${id}`

// The windows that have just been closed, kept on screen for as long as they take to fade out.
function useLeaving(windows: Windows): [readonly OpenWindow[], (id: WindowId) => void] {
  const [seen, setSeen] = useState(windows)
  const [leaving, setLeaving] = useState<readonly OpenWindow[]>([])
  if (seen !== windows) {
    setSeen(windows)
    // One opened again while it fades out is open, not leaving.
    setLeaving([...leaving, ...seen].filter((gone) => !isOpen(windows, gone.id)))
  }
  const left = useCallback((id: WindowId) => setLeaving((still) => still.filter((gone) => gone.id !== id)), [])
  return [leaving, left]
}

// The glass windows of the Twin's screen, laid over the scene: a bar that opens and closes each, and the open
// ones in their slots beside the Outpost, tilted toward it. What a window shows scrolls inside it where it is
// taller than its slot. They are HTML, not part of the 3D scene: each is a
// named region the keyboard reaches, closed by its button or by Escape. A hand that aims lights the one its
// sight is on, and the one it shoots goes out in a burst of light.
export function GlassWindows({ windows, send, content, aimed = null, shot = [] }: GlassWindowsProps) {
  const [leaving, left] = useLeaving(windows)
  // Closed from inside the window: the focus was in what goes away, and goes back to what brings it back.
  const close = (id: WindowId) => {
    send({ type: 'close', id })
    document.getElementById(toggleId(id))?.focus()
  }

  // From the top of each side down: the order they are read in, and the keyboard's.
  const shown = [...windows, ...leaving].toSorted((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot))

  return (
    <>
      <div className="window-bar" role="toolbar" aria-label="Fenêtres">
        {WINDOW_IDS.map((id) => {
          const open = isOpen(windows, id)
          return (
            <button
              key={id}
              type="button"
              id={toggleId(id)}
              aria-pressed={open}
              title={open ? `Fermer la fenêtre ${WINDOWS[id].name}` : `Ouvrir la fenêtre ${WINDOWS[id].name}`}
              onClick={() => send(open ? { type: 'close', id } : { type: 'open', id, by: 'operator', at: Date.now() })}
            >
              {WINDOWS[id].name}
            </button>
          )
        })}
      </div>
      <div className="glass-windows">
        {SIDES.map((side) => (
          <div key={side} className="glass-column" data-side={side}>
            {shown
              .filter(({ slot }) => SLOT_PLACE[slot].side === side)
              .map(({ id, slot }) => {
                // Closed, only not gone yet: out of the way of the keyboard and of screen readers while it fades out.
                const gone = !isOpen(windows, id)
                return (
                  <section
                    key={id}
                    className="glass-window"
                    data-window={id}
                    data-row={SLOT_PLACE[slot].row}
                    data-aimed={(!gone && aimed === id) || undefined}
                    data-leaving={gone ? (shot.includes(id) ? 'shot' : 'closed') : undefined}
                    inert={gone}
                    aria-label={`Fenêtre ${WINDOWS[id].name}`}
                    onAnimationEnd={(event) => {
                      if (gone && event.target === event.currentTarget) left(id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return
                      event.stopPropagation()
                      close(id)
                    }}
                  >
                    <header>
                      <h2>{WINDOWS[id].name}</h2>
                      <button
                        type="button"
                        aria-label={`Fermer la fenêtre ${WINDOWS[id].name}`}
                        title="Fermer (Échap)"
                        onClick={() => close(id)}
                      >
                        ×
                      </button>
                    </header>
                    <div className="glass-window-body">{content[id]}</div>
                  </section>
                )
              })}
          </div>
        ))}
      </div>
    </>
  )
}

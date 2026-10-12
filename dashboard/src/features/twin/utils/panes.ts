// What is laid over the Twin's view and is no part of its scene: panes on the screen, each a rectangle in the
// screen's pixels. The sight of a hand that aims is on the same screen: it designates the pane it is over, and
// a shot there hits the pane, not what stands behind it. The Twin knows nothing more of them: whoever lays
// them over it says where they are, and is told what the sight does to them.

export interface Pane {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

export interface Panes {
  // The pane at a point of the screen, in pixels, if any.
  at(x: number, y: number): Pane | null
  // Told on every frame which pane the sight is on: null for none, and while no hand aims.
  sighted(id: string | null): void
  // Told of a shot that hit a pane.
  shot(id: string): void
}

// The rectangle the view takes of the screen, in pixels.
export interface ViewFrame {
  left: number
  top: number
  width: number
  height: number
}

// Where a point of the view (each from -1 to 1, x to the right, y up) is on the screen, in pixels.
export function onScreen(frame: ViewFrame, x: number, y: number): [x: number, y: number] {
  return [frame.left + ((x + 1) / 2) * frame.width, frame.top + ((1 - y) / 2) * frame.height]
}

// And back: where a pixel of the screen is in the view.
export function inView(frame: ViewFrame, x: number, y: number): [x: number, y: number] {
  return [((x - frame.left) / frame.width) * 2 - 1, 1 - ((y - frame.top) / frame.height) * 2]
}

// Where on a pane the mote `index` of the burst it comes apart in starts, across it and up it, each from -1
// to 1: spread over all of it, the same at every shot, and those that start high are those that fly up.
export function paneSpot(index: number): [across: number, up: number] {
  const share = (spread: number) => ((index + 1) * spread) % 1
  return [2 * share(0.819) - 1, 2 * share(0.755) - 1]
}

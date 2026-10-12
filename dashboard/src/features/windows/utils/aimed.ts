import type { WindowId } from './windows'

// The windows under a hand that aims. The sight and the windows are on the same screen: a window is the
// rectangle it takes of it, in pixels, and the sight a point. Pure: whoever measures the screen brings both.

export interface WindowRect {
  id: WindowId
  left: number
  top: number
  right: number
  bottom: number
}

// The window a sight at (x, y) is on, if any: the one whose rectangle holds it. Two neighbours never both:
// where their rectangles meet, the one whose middle is nearest the sight.
export function windowAt(rects: readonly WindowRect[], x: number, y: number): WindowRect | null {
  const off = (rect: WindowRect) => Math.hypot((rect.left + rect.right) / 2 - x, (rect.top + rect.bottom) / 2 - y)
  return rects
    .filter((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
    .reduce<WindowRect | null>((nearest, rect) => (nearest && off(nearest) <= off(rect) ? nearest : rect), null)
}

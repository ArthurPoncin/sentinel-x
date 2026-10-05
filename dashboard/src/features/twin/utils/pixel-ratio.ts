// Past 2 the eye sees no difference and the GPU does.
export const MAX_PIXEL_RATIO = 2
// The most pixels the Twin draws, however large or dense the screen. Measured on an integrated GPU (Iris Xe):
// 3.4 million still hold 60 images per second, 4.9 million do not. Raise it on a stronger machine.
export const MAX_PIXELS = 3_000_000

// Pixel ratio the Twin renders at, for a canvas of this size (CSS pixels) on a screen of this density.
export function pixelRatio(devicePixelRatio: number, width: number, height: number): number {
  const ratio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO)
  const pixels = width * height * ratio * ratio
  return pixels > MAX_PIXELS ? ratio * Math.sqrt(MAX_PIXELS / pixels) : ratio
}

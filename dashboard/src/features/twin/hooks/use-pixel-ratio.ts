import { type RefObject, useLayoutEffect, useState } from 'react'
import { pixelRatio } from '../utils/pixel-ratio'

// Pixel ratio to render at inside this element, following its size.
export function usePixelRatio(element: RefObject<HTMLElement | null>): number {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    const measure = () => setSize({ width: target.clientWidth, height: target.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    measure()

    return () => observer.disconnect()
  }, [element])

  return pixelRatio(window.devicePixelRatio, size.width, size.height)
}

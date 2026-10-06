import { captureMode } from '@/shared/config/capture-mode'

// What a route says about itself in the router (`handle`).
export interface RouteHandle {
  // A full-bleed stage (the Twin): it takes the whole space under the header, with no page padding.
  stage?: boolean
}

// page: the padded page under the header. stage: the whole space under the header. capture: the stage alone on
// the window, no sidebar, no header, to be filmed for the teaser (`?capture`, on a stage route only).
export type LayoutMode = 'page' | 'stage' | 'capture'

export function layoutMode(
  matches: readonly { handle?: unknown }[],
  location: Pick<Location, 'search'>,
): LayoutMode {
  const stage = matches.some((match) => (match.handle as RouteHandle | undefined)?.stage === true)
  if (!stage) return 'page'
  return captureMode(location) ? 'capture' : 'stage'
}

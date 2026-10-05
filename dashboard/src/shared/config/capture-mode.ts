// `?capture` on the address asks for the Twin alone, with no interface around it, to be filmed for the teaser.
// The parameter being there is enough, whatever its value.
export function captureMode(location: Pick<Location, 'search'>): boolean {
  return new URLSearchParams(location.search).has('capture')
}

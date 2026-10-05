// The live feed is served by the app's own origin: through the reverse proxy on the Command Post,
// through the Vite proxy in dev (see BACKEND_URL). Mock or live is the backend's business, not ours.
export function feedUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws`
}

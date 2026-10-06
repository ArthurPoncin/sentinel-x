import type { z } from 'zod'

// A response the Command Post API turned down, with its status for the caller to explain.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

// Same origin as the app (reverse proxy on the Command Post, Vite proxy in dev): the Operator
// session cookie rides along on its own.
const sameOrigin = { credentials: 'same-origin' } as const

const unauthorized = new Set<() => void>()

// Tells `listener` each time the API answers 401: there is no Operator session any more, whoever
// was asking. Returns what stops it. A wrong password at the login screen is a 401 too: nobody is in
// then, so there is nobody to send out.
export function onUnauthorized(listener: () => void): () => void {
  unauthorized.add(listener)
  return () => {
    unauthorized.delete(listener)
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(path, { ...sameOrigin, ...init })
  if (response.status === 401) for (const listener of unauthorized) listener()
  return response
}

// GETs a JSON body and checks it against the contract: a reply outside it is an error, not data.
export async function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await send(path, { signal })
  if (!response.ok) throw new HttpError(response.status, `GET ${path} answered ${response.status}`)
  return schema.parse(await response.json())
}

// POSTs a JSON body; the caller reads the status, since each endpoint gives it its own meaning.
export function postJson(path: string, body?: unknown): Promise<Response> {
  return send(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

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

// GETs a JSON body and checks it against the contract: a reply outside it is an error, not data.
export async function getJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { ...sameOrigin, signal })
  if (!response.ok) throw new HttpError(response.status, `GET ${path} answered ${response.status}`)
  return schema.parse(await response.json())
}

// POSTs a JSON body; the caller reads the status, since each endpoint gives it its own meaning.
export function postJson(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    ...sameOrigin,
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

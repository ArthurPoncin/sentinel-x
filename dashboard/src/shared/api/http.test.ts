import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { getJson, HttpError, onUnauthorized, postJson } from './http'

const Body = z.object({ ok: z.boolean() })

function answer(status: number, body: unknown = { ok: true }) {
  const fetch = vi.fn(
    async (_path: string, _init?: RequestInit) => new Response(status === 204 ? null : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const stops: (() => void)[] = []
function listen() {
  const listener = vi.fn()
  stops.push(onUnauthorized(listener))
  return listener
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  vi.unstubAllGlobals()
})

describe('the Command Post API helpers', () => {
  it('GETs a body in the contract, on the app’s own origin', async () => {
    const fetch = answer(200)

    expect(await getJson('/api/v1/thing', Body)).toEqual({ ok: true })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/thing')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' })
  })

  it('fails a GET the API turns down, with its status', async () => {
    answer(503)

    await expect(getJson('/api/v1/thing', Body)).rejects.toEqual(new HttpError(503, 'GET /api/v1/thing answered 503'))
  })

  it('POSTs a JSON body and hands the reply over, whatever its status', async () => {
    const fetch = answer(429)

    expect((await postJson('/api/v1/thing', { ok: false })).status).toBe(429)
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{"ok":false}',
    })
  })
})

describe('onUnauthorized', () => {
  it('tells when a GET is turned down for want of a session, and still fails it', async () => {
    const listener = listen()
    answer(401)

    await expect(getJson('/api/v1/thing', Body)).rejects.toThrow('answered 401')
    expect(listener).toHaveBeenCalledOnce()
  })

  it('tells when a POST is turned down for want of a session, and still hands the reply over', async () => {
    const listener = listen()
    answer(401)

    expect((await postJson('/api/v1/thing')).status).toBe(401)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('says nothing of any other reply', async () => {
    const listener = listen()

    for (const status of [200, 204, 400, 403, 429, 503]) {
      answer(status)
      await postJson('/api/v1/thing')
    }
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops telling once the listener is removed', async () => {
    const listener = vi.fn()
    const stop = onUnauthorized(listener)
    stop()
    answer(401)

    await postJson('/api/v1/thing')
    expect(listener).not.toHaveBeenCalled()
  })
})

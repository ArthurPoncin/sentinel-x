import { describe, expect, it } from 'vitest'
import { createClientAddress } from '../src/client-address.js'
import { startServer } from './support/server.js'

const PROXY = '172.18.0.5'

describe('client address', () => {
  it('keeps the address of the connection when no reverse proxy is trusted', async () => {
    const clientAddress = createClientAddress(false)

    expect(await clientAddress.of('192.168.4.20', '203.0.113.7')).toBe('192.168.4.20')
  })

  it('believes the forwarded address when the connection comes from the reverse proxy', async () => {
    const clientAddress = createClientAddress('reverse-proxy', async () => [PROXY])

    expect(await clientAddress.of(PROXY, '192.168.4.20')).toBe('192.168.4.20')
    expect(await clientAddress.of(`::ffff:${PROXY}`, '192.168.4.20')).toBe('192.168.4.20')
  })

  it('does not believe a forwarded address sent by anyone else', async () => {
    const clientAddress = createClientAddress('reverse-proxy', async () => [PROXY])

    expect(await clientAddress.of('172.18.0.9', '192.168.4.20')).toBe('172.18.0.9')
  })

  it('takes the address the reverse proxy added, not the ones that came before it', async () => {
    const clientAddress = createClientAddress('reverse-proxy', async () => [PROXY])

    expect(await clientAddress.of(PROXY, '10.0.0.1, 192.168.4.20')).toBe('192.168.4.20')
    expect(await clientAddress.of(PROXY, ['10.0.0.1', '10.0.0.2, 192.168.4.21'])).toBe('192.168.4.21')
  })

  it('keeps the address of the connection when the reverse proxy forwards none, or not an address', async () => {
    const clientAddress = createClientAddress('reverse-proxy', async () => [PROXY])

    expect(await clientAddress.of(PROXY, undefined)).toBe(PROXY)
    expect(await clientAddress.of(PROXY, 'not an address')).toBe(PROXY)
  })

  it('trusts no one while the name of the reverse proxy does not resolve', async () => {
    const clientAddress = createClientAddress('reverse-proxy', async () => {
      throw new Error('ENOTFOUND')
    })

    expect(await clientAddress.of(PROXY, '192.168.4.20')).toBe(PROXY)
  })

  it('follows the reverse proxy to its new address, and forgets the old one', async () => {
    let now = 0
    let address = PROXY
    const clientAddress = createClientAddress('reverse-proxy', async () => [address], () => now)
    await clientAddress.of(PROXY, '192.168.4.20')

    address = '172.18.0.6'
    now = 60_000

    expect(await clientAddress.of('172.18.0.6', '192.168.4.20')).toBe('192.168.4.20')
    expect(await clientAddress.of(PROXY, '192.168.4.20')).toBe(PROXY)
  })

  it('does not ask for the name again at every request', async () => {
    let lookups = 0
    const clientAddress = createClientAddress('reverse-proxy', async () => {
      lookups++
      return [PROXY]
    })

    await clientAddress.of(PROXY, '192.168.4.20')
    await clientAddress.of('172.18.0.9', '192.168.4.20')
    await clientAddress.of(PROXY, '192.168.4.21')

    expect(lookups).toBe(1)
  })
})

describe('login limit behind the reverse proxy', () => {
  const login = (request: (path: string, init?: RequestInit) => Promise<Response>, forwardedFor: string) =>
    request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
      body: JSON.stringify({ password: 'a guess' }),
    })

  // The tests reach the API from 127.0.0.1: trusting it makes them the reverse proxy.
  it('gives each address its own limit: one that used its own up does not lock another out', async () => {
    const { request } = await startServer({ trustedProxy: '127.0.0.1' })

    for (let attempt = 0; attempt < 5; attempt++) await login(request, '192.168.4.66')

    expect((await login(request, '192.168.4.66')).status).toBe(429)
    expect((await login(request, '192.168.4.20')).status).toBe(204)
  })

  it('does not believe the header of a client that is not the reverse proxy', async () => {
    const { request } = await startServer({ trustedProxy: '172.18.0.5' })

    for (let attempt = 0; attempt < 5; attempt++) await login(request, `192.168.4.${attempt}`)

    expect((await login(request, '192.168.4.99')).status).toBe(429)
  })

  it('keeps the address of the connection without a reverse proxy in front', async () => {
    const { request } = await startServer()

    for (let attempt = 0; attempt < 5; attempt++) await login(request, `192.168.4.${attempt}`)

    expect((await login(request, '192.168.4.99')).status).toBe(429)
  })
})

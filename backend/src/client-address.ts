import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export interface ClientAddress {
  // The address a request really comes from: the one `forwardedFor` (its X-Forwarded-For) gives
  // when `connection` is the reverse proxy, the connection's own otherwise.
  of(connection: string, forwardedFor: string | string[] | undefined): Promise<string>
}

// How long the addresses of the reverse proxy are kept before its name is asked for again:
// Compose may give it another one when its container is made again.
const RESOLVE_TTL_MS = 30_000

const resolveAll = async (host: string) => (await lookup(host, { all: true })).map(({ address }) => address)

// An IPv4 address as a dual-stack socket gives it (::ffff:172.18.0.5), in its plain form.
const plain = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')

// `trustedProxy` names the one reverse proxy whose X-Forwarded-For is believed, by host name or
// address; `false` believes no one and keeps the address of the connection.
export function createClientAddress(
  trustedProxy: false | string,
  resolve: (host: string) => Promise<string[]> = resolveAll,
  now: () => number = Date.now,
): ClientAddress {
  let proxies = new Set<string>()
  let resolvedAt: number | undefined

  async function isProxy(address: string): Promise<boolean> {
    if (!trustedProxy) return false
    const at = now()
    if (resolvedAt === undefined || at - resolvedAt >= RESOLVE_TTL_MS) {
      resolvedAt = at
      // A name that does not resolve trusts no one, until the next try.
      proxies = new Set(await resolve(trustedProxy).then((addresses) => addresses.map(plain), () => []))
    }
    return proxies.has(address)
  }

  return {
    async of(connection, forwardedFor) {
      const from = plain(connection)
      if (!(await isProxy(from))) return from
      // The last one is the reverse proxy's own word; what comes before it is the client's.
      const forwarded = [forwardedFor ?? []].flat().join(',').split(',').at(-1)?.trim() ?? ''
      return isIP(forwarded) ? plain(forwarded) : from
    },
  }
}

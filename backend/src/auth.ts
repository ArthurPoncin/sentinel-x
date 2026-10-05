import { createHash, timingSafeEqual } from 'node:crypto'
import type { AlertSource } from './contract.js'

// The services that post to POST /api/v1/alerts, each with a bearer token of its own.
export type Service = Exclude<AlertSource, 'esp32'>
export type ServiceTokens = Partial<Record<Service, string>>

// Same length whatever the input, so the comparison takes the same time whatever was sent.
const digest = (text: string) => createHash('sha256').update(text).digest()

function sameSecret(sent: string, expected: string): boolean {
  return timingSafeEqual(digest(sent), digest(expected))
}

// The service an `Authorization: Bearer <token>` header names, or undefined. Every configured
// token is compared, in constant time, whichever matches.
export function serviceOf(authorization: string | undefined, tokens: ServiceTokens): Service | undefined {
  const sent = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1]
  if (sent === undefined) return undefined
  let found: Service | undefined
  for (const [service, token] of Object.entries(tokens) as [Service, string | undefined][]) {
    if (token !== undefined && sameSecret(sent, token)) found = service
  }
  return found
}

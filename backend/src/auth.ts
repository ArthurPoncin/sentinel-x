import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
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

// The Operator's password, stored as `scrypt:<salt>:<key>` (hex): no `$` for a .env to expand.
const SCRYPT_KEY_LENGTH = 64
const PASSWORD_HASH = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password, salt, SCRYPT_KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key))),
  )
}

export function isPasswordHash(text: string): boolean {
  return PASSWORD_HASH.test(text)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${(await scrypt(password, salt)).toString('hex')}`
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [, salt, key] = PASSWORD_HASH.exec(hash) ?? []
  if (salt === undefined || key === undefined) return false
  return timingSafeEqual(await scrypt(password, Buffer.from(salt, 'hex')), Buffer.from(key, 'hex'))
}

export const SESSION_COOKIE = 'sx_session'
// A demo day, then log in again.
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export interface Sessions {
  // Opens a session and returns its id, the cookie's value.
  open(): string
  isOpen(id: string | undefined): boolean
  close(id: string | undefined): void
}

// Operator sessions, in the process: a restart logs everyone out. Ids are kept hashed, so a
// lookup leaks nothing about the ids it does not match.
export function createSessions(now: () => number = Date.now): Sessions {
  const expiry = new Map<string, number>()
  const key = (id: string) => createHash('sha256').update(id).digest('base64url')

  return {
    open() {
      for (const [hashed, until] of expiry) if (until <= now()) expiry.delete(hashed)
      const id = randomBytes(32).toString('base64url')
      expiry.set(key(id), now() + SESSION_TTL_MS)
      return id
    },
    isOpen(id) {
      if (id === undefined) return false
      const until = expiry.get(key(id))
      return until !== undefined && now() < until
    },
    close(id) {
      if (id !== undefined) expiry.delete(key(id))
    },
  }
}

// The value of one cookie in a Cookie header.
export function cookieOf(header: string | undefined, name: string): string | undefined {
  for (const pair of (header ?? '').split(';')) {
    const [key, ...value] = pair.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

// Only over HTTPS, out of reach of scripts, never sent along with a request from another site.
export function sessionCookie(id: string, maxAgeMs = SESSION_TTL_MS): string {
  const maxAge = Math.floor(maxAgeMs / 1000)
  return `${SESSION_COOKIE}=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
}

// Whether a browser page from `origin` may open the feed: the API's own origin, as the browser
// reached it, or one of the front-ends allowed by CORS. Non-browser clients send no Origin.
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined) return true
  if (allowed.includes(origin)) return true
  return URL.canParse(origin) && host !== undefined && new URL(origin).host === host
}

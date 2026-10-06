import { postJson } from '@/shared/api/http'
import type { SessionAnswer } from '../utils/session'

export type LoginOutcome = 'ok' | 'wrong-password' | 'throttled' | 'unreachable'

// What a login reply means for the Operator: the API gives 204, 401 or 429 (5 tries a minute).
export function loginOutcome(status: number): LoginOutcome {
  if (status === 204) return 'ok'
  if (status === 401 || status === 400) return 'wrong-password'
  if (status === 429) return 'throttled'
  return 'unreachable'
}

// What a reply of GET /api/v1/auth/check says: 204 with a session (or with OPERATOR_AUTH=off), 401
// without. Anything else says nothing of the session: the API is restarting behind its proxy.
export function sessionAnswer(status: number): SessionAnswer {
  if (status === 204) return 'open'
  if (status === 401) return 'closed'
  return 'unknown'
}

// Asks the Command Post whether the Operator's session stands. Never fails: out of reach is no answer.
export async function checkSession(): Promise<SessionAnswer> {
  try {
    return sessionAnswer((await fetch('/api/v1/auth/check', { credentials: 'same-origin' })).status)
  } catch {
    return 'unknown'
  }
}

export async function login(password: string): Promise<LoginOutcome> {
  try {
    return loginOutcome((await postJson('/api/v1/auth/login', { password })).status)
  } catch {
    return 'unreachable'
  }
}

export async function logout(): Promise<void> {
  await postJson('/api/v1/auth/logout')
}

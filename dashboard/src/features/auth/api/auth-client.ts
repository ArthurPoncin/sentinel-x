import { postJson } from '@/shared/api/http'

export type LoginOutcome = 'ok' | 'wrong-password' | 'throttled' | 'unreachable'

// What a login reply means for the Operator: the API gives 204, 401 or 429 (5 tries a minute).
export function loginOutcome(status: number): LoginOutcome {
  if (status === 204) return 'ok'
  if (status === 401 || status === 400) return 'wrong-password'
  if (status === 429) return 'throttled'
  return 'unreachable'
}

// 204 with a session (or with OPERATOR_AUTH=off), 401 without.
export async function hasSession(): Promise<boolean> {
  const response = await fetch('/api/v1/auth/check', { credentials: 'same-origin' })
  return response.status === 204
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

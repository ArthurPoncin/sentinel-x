// Types for brute-login.mjs, so TypeScript callers (the tests) see its contract. The script itself
// stays plain Node with no build step.

export interface BruteForceOptions {
  // Base URL of the Command Post, e.g. https://192.168.4.1; the login path is appended.
  target: string
  // Wrong logins sent per second.
  ratePerSec: number
  // How long to run before it stops by itself, in milliseconds.
  durationMs: number
  // PEM file of the team CA to trust, added to the public roots (HTTPS targets). TLS stays verified.
  caFile?: string
  // How long a single request waits for an answer before it is given up as unanswered, in
  // milliseconds (default 10000). A stalled connection cannot keep the run from stopping by itself.
  timeoutMs?: number
}

export interface BruteForceSummary {
  // How many wrong logins were sent.
  attempts: number
  // How many came back 401 (wrong password) and 429 (past the login rate limit).
  refused401: number
  refused429: number
  // How many were neither: unreachable, a refused TLS handshake, or an unexpected status.
  other: number
}

export function bruteForceLogin(options: BruteForceOptions): Promise<BruteForceSummary>

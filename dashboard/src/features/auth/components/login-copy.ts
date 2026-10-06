import type { LoginOutcome } from '../api/auth-client'

// What the login screen says after a refusal: one line, the next step in it.
export const REFUSAL: Record<Exclude<LoginOutcome, 'ok'>, string> = {
  'wrong-password': 'Mot de passe incorrect. Accès refusé.',
  throttled: 'Trop de tentatives : le poste de commande bloque les essais une minute.',
  unreachable: 'Le poste de commande est injoignable. Vérifiez le Wi-Fi de la table.',
}

export interface Channel {
  secure: boolean
  label: string
}

// Whether the session will travel encrypted, from the page's own protocol: HTTPS behind the reverse proxy on
// the Pi, plain HTTP only on a developer's machine. Said as it is, never claimed.
export function channelOf(protocol: string): Channel {
  return protocol === 'https:'
    ? { secure: true, label: 'Canal chiffré · TLS' }
    : { secure: false, label: 'Canal non chiffré · dev' }
}

// The clock in the panel's corner, UTC like every timestamp of the Outpost.
export function utcClock(at: Date): string {
  return `${at.toISOString().slice(11, 19)} UTC`
}

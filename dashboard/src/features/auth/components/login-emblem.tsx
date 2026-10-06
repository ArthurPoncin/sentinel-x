import { LockKeyhole, ShieldAlert, ShieldCheck } from 'lucide-react'

export type LoginPhase = 'idle' | 'checking' | 'denied' | 'granted'

const GLYPH = {
  idle: LockKeyhole,
  checking: LockKeyhole,
  denied: ShieldAlert,
  granted: ShieldCheck,
} as const

// The hexagon of the Enclosure behind its rings, in the phase's color: the rings turn while it waits, faster
// while the Command Post checks, and the glyph says how it ended. Decoration only: the words are elsewhere.
export function LoginEmblem({ phase }: { phase: LoginPhase }) {
  const Glyph = GLYPH[phase]
  return (
    <div className="login-emblem" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="login-emblem-rings">
        <circle className="login-ring login-ring-outer" cx="60" cy="60" r="56" />
        <circle className="login-ring login-ring-middle" cx="60" cy="60" r="46" />
        <g className="login-ring-orbit">
          <circle cx="60" cy="14" r="2.5" />
        </g>
        <path
          className="login-hexagon"
          d="M60 28 L87.7 44 L87.7 76 L60 92 L32.3 76 L32.3 44 Z"
        />
      </svg>
      <Glyph key={phase} className="login-emblem-glyph" strokeWidth={1.6} />
    </div>
  )
}

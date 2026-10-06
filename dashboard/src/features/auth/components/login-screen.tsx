import { Eye, EyeOff, KeyRound, LockKeyhole, TriangleAlert } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { login } from '../api/auth-client'
import { channelOf, REFUSAL, utcClock } from './login-copy'
import { LoginEmblem, type LoginPhase } from './login-emblem'
import './login-screen.css'

// How long "Accès autorisé" stays on before the dashboard: long enough to be read, short enough not to wait.
const GRANTED_MS = 900

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function useUtcClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return utcClock(now)
}

// The Command Post's door: a password, checked by the API, which sets the session cookie. Everything around
// the form is the Outpost's control-room look — a grid floor, a radar sweep, the Enclosure's hexagon — and
// moves only as decoration: with reduced motion asked for, it all holds still.
export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  // Bumped on each refusal: the panel shakes again even when the message stays the same.
  const [refusals, setRefusals] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const clock = useUtcClock()
  const channel = channelOf(window.location.protocol)

  useEffect(() => {
    if (phase !== 'granted') return
    const timer = setTimeout(onSignedIn, prefersReducedMotion() ? 0 : GRANTED_MS)
    return () => clearTimeout(timer)
  }, [phase, onSignedIn])

  // The field is disabled while the Command Post checks: focus it again once it can take a new try.
  useEffect(() => {
    if (phase === 'denied') input.current?.focus()
  }, [phase, refusals])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (phase === 'checking' || phase === 'granted' || password === '') return
    setPhase('checking')
    setError(null)
    const outcome = await login(password)
    if (outcome === 'ok') return setPhase('granted')
    setPhase('denied')
    setError(REFUSAL[outcome])
    setRefusals((count) => count + 1)
    setPassword('')
  }

  const watchCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'))

  const busy = phase === 'checking' || phase === 'granted'

  return (
    <main className="login" data-phase={phase}>
      <div className="login-floor" aria-hidden="true" />
      <div className="login-radar" aria-hidden="true" />
      <div className="login-scanline" aria-hidden="true" />

      <div className="login-column">
        <section className="login-panel" data-shake={refusals === 0 ? undefined : refusals % 2} aria-labelledby="login-title">
          <span className="login-corner login-corner-tl" aria-hidden="true" />
          <span className="login-corner login-corner-tr" aria-hidden="true" />
          <span className="login-corner login-corner-bl" aria-hidden="true" />
          <span className="login-corner login-corner-br" aria-hidden="true" />

          <header className="login-header">
            <LoginEmblem phase={phase} />
            <h1 id="login-title" className="login-title">
              Sentinel-X
            </h1>
            <p className="login-subtitle">Poste de commande · Accès opérateur</p>
          </header>

          <div className="login-readouts">
            <span className="login-readout" data-secure={channel.secure}>
              <span className="login-led" />
              {channel.label}
            </span>
            <span className="login-readout login-mono">{clock}</span>
          </div>

          {phase === 'granted' ? (
            <div className="login-granted" role="status">
              <span className="login-granted-title">Accès autorisé</span>
              <span className="login-granted-detail">Ouverture du poste de commande…</span>
            </div>
          ) : (
            <form onSubmit={submit} className="login-form" noValidate>
              <label htmlFor="password" className="login-label">
                <KeyRound className="size-3.5" />
                Mot de passe opérateur
              </label>
              <div className="login-field">
                <LockKeyhole className="login-field-icon" />
                <input
                  ref={input}
                  id="password"
                  type={visible ? 'text' : 'password'}
                  className="login-input"
                  autoComplete="current-password"
                  autoFocus
                  required
                  spellCheck={false}
                  value={password}
                  disabled={busy}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    // A new try: the emblem calms down, the refusal stays until it is sent.
                    if (phase === 'denied') setPhase('idle')
                  }}
                  onKeyDown={watchCapsLock}
                  onKeyUp={watchCapsLock}
                  aria-invalid={error !== null}
                  aria-describedby={error ? 'login-error' : capsLock ? 'login-caps' : undefined}
                />
                <button
                  type="button"
                  className="login-reveal"
                  onClick={() => setVisible((shown) => !shown)}
                  aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={visible}
                  disabled={busy}
                >
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              {capsLock && !error && (
                <p id="login-caps" className="login-hint">
                  Verrouillage majuscules activé
                </p>
              )}
              {error && (
                <p key={refusals} id="login-error" className="login-error" role="alert">
                  <TriangleAlert className="size-4 shrink-0" />
                  {error}
                </p>
              )}

              <button type="submit" className="login-submit" disabled={busy || password === ''}>
                <span>{phase === 'checking' ? 'Vérification…' : 'Authentifier'}</span>
              </button>
            </form>
          )}
        </section>

        <footer className="login-footer">
          <span>AetherCorp · Sentinel-X — security at the edge</span>
          <span className="login-mono">5 essais / min · session HttpOnly</span>
        </footer>
      </div>
    </main>
  )
}

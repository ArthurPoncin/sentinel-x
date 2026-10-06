import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState } from 'react'
import { onUnauthorized } from '@/shared/api/http'
import { checkSession, logout } from '../api/auth-client'
import { afterCheck, type Session } from '../utils/session'
import { LoginScreen } from './login-screen'

interface Gate {
  signOut: () => void
  check: () => void
}

const GateContext = createContext<Gate | null>(null)

// Nothing below it mounts without an Operator session: the live feed's socket would be turned
// down anyway, and would then retry on a long backoff. The same goes once the session is gone, after
// 12 h or a restart of the API: back to the login screen, and what was below stops with it.
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>('checking')

  const check = useCallback(() => {
    checkSession().then((answer) => setSession((current) => afterCheck(current, answer)))
  }, [])

  useEffect(check, [check])

  // A call the API turns down for want of a session says it as well as a check would.
  useEffect(() => onUnauthorized(() => setSession((current) => afterCheck(current, 'closed'))), [])

  const signOut = useCallback(() => {
    logout().finally(() => setSession('out'))
  }, [])

  const gate = useMemo(() => ({ signOut, check }), [signOut, check])

  if (session === 'checking') return null
  if (session === 'out') return <LoginScreen onSignedIn={() => setSession('in')} />
  return <GateContext value={gate}>{children}</GateContext>
}

function useGate(): Gate {
  const gate = use(GateContext)
  if (!gate) throw new Error('The Operator session is only known inside <AuthGate>')
  return gate
}

export function useSignOut(): () => void {
  return useGate().signOut
}

// Asks the Command Post whether the session still stands: to call when something says it may not,
// like the feed going down. A session that is gone brings the login screen back.
export function useSessionCheck(): () => void {
  return useGate().check
}

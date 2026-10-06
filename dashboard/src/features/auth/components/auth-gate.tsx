import { createContext, type ReactNode, use, useCallback, useEffect, useState } from 'react'
import { hasSession, logout } from '../api/auth-client'
import { LoginScreen } from './login-screen'

type Session = 'checking' | 'in' | 'out'

const SignOutContext = createContext<(() => void) | null>(null)

// Nothing below it mounts without an Operator session: the live feed's socket would be turned
// down anyway, and would then retry on a long backoff.
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>('checking')

  useEffect(() => {
    hasSession()
      .then((open) => setSession(open ? 'in' : 'out'))
      .catch(() => setSession('out'))
  }, [])

  const signOut = useCallback(() => {
    logout().finally(() => setSession('out'))
  }, [])

  if (session === 'checking') return null
  if (session === 'out') return <LoginScreen onSignedIn={() => setSession('in')} />
  return <SignOutContext value={signOut}>{children}</SignOutContext>
}

export function useSignOut(): () => void {
  const signOut = use(SignOutContext)
  if (!signOut) throw new Error('useSignOut must be used inside <AuthGate>')
  return signOut
}

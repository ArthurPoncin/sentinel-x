// Where the Operator stands: not known yet, in the app, or at the login screen.
export type Session = 'checking' | 'in' | 'out'

// What the Command Post says of the session when asked: it stands, it is gone, or it did not say.
export type SessionAnswer = 'open' | 'closed' | 'unknown'

// The session once the Command Post answered. At load, only a session lets in. Once in, only a clear
// "no" sends back to the login screen: a Command Post that does not answer has lost its signal, not
// its Operator. And from the login screen, only a login lets back in.
export function afterCheck(session: Session, answer: SessionAnswer): Session {
  if (session === 'out') return 'out'
  if (answer === 'open') return 'in'
  if (answer === 'closed') return 'out'
  return session === 'checking' ? 'out' : session
}

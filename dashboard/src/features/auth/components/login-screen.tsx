import { ShieldCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { login, type LoginOutcome } from '../api/auth-client'

const MESSAGE: Record<Exclude<LoginOutcome, 'ok'>, string> = {
  'wrong-password': 'Wrong password.',
  throttled: 'Too many attempts. Wait a minute and try again.',
  unreachable: 'The Command Post cannot be reached.',
}

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    const outcome = await login(password)
    setPending(false)
    if (outcome === 'ok') return onSignedIn()
    setError(MESSAGE[outcome])
    setPassword('')
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-nominal/15 text-nominal">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle className="text-xl">Sentinel-X Command Post</CardTitle>
          <CardDescription>Operator access only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error !== null}
              />
              {error && <p className="text-sm text-critical">{error}</p>}
            </div>
            <Button type="submit" disabled={pending || password === ''}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

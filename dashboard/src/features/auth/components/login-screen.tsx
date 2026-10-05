import { Shield } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { login, type LoginOutcome } from '../api/auth-client'

const MESSAGE: Record<Exclude<LoginOutcome, 'ok'>, string> = {
  'wrong-password': 'Mot de passe incorrect.',
  throttled: 'Trop de tentatives. Patientez une minute.',
  unreachable: 'Le poste de commande est injoignable.',
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
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2 font-medium">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Shield className="size-4" />
        </div>
        Sentinel-X
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Connexion opérateur</CardTitle>
          <CardDescription>Accès réservé au poste de commande</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-6">
            <div className="grid gap-3">
              <Label htmlFor="password">Mot de passe</Label>
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
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={pending || password === ''}>
              {pending ? 'Connexion…' : 'Se connecter'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

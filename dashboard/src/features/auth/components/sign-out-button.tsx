import { LogOut } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useSignOut } from './auth-gate'

export function SignOutButton() {
  const signOut = useSignOut()
  return (
    <Button variant="ghost" size="sm" onClick={signOut}>
      <LogOut />
      Sign out
    </Button>
  )
}

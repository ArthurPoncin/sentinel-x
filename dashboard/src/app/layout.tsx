import { Shield } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { SignOutButton } from '@/features/auth'
import { ConnectionIndicator, useLiveFeed } from '@/features/live-feed'
import { StatusBadge } from '@/features/status'
import { cn } from '@/shared/lib/utils'

const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm transition-colors',
    isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
  )

export function Layout() {
  const status = useLiveFeed((state) => state.status)

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 lg:px-6">
          <span className="flex items-center gap-2 font-semibold tracking-wider">
            <Shield className="size-5 text-nominal" />
            SENTINEL-X
          </span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={link}>
              Operator
            </NavLink>
            <NavLink to="/twin" className={link}>
              Digital Twin
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <StatusBadge status={status} />
            <ConnectionIndicator />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  )
}

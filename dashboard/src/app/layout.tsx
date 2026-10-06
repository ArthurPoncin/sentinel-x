import { NavLink, Outlet, useLocation, useMatches } from 'react-router'
import { useSignOut } from '@/features/auth'
import { ConnectionIndicator, useLiveFeed } from '@/features/live-feed'
import { StatusBadge } from '@/features/status'
import { cn } from '@/shared/lib/utils'
import { layoutMode } from './layout-mode'

// The two surfaces, one per screen for the demo.
const NAV = [
  { to: '/', label: 'Opérateur' },
  { to: '/twin', label: 'Jumeau numérique' },
] as const

// One bar across the top, on every screen: the brand, the two surfaces, then the Status and whether
// the feed is live, where the eye lands first.
function TopBar() {
  const status = useLiveFeed((state) => state.status)
  const signOut = useSignOut()

  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b bg-card px-5">
      <span className="font-bold tracking-[0.08em]">Sentinel-X</span>
      <nav className="flex flex-1 gap-4">
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn('text-muted-foreground transition-colors hover:text-foreground', isActive && 'text-foreground')
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <StatusBadge status={status} />
      <ConnectionIndicator />
      <button
        type="button"
        onClick={signOut}
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        Déconnexion
      </button>
    </header>
  )
}

export function Layout() {
  const mode = layoutMode(useMatches(), useLocation())

  // Filmed for the teaser: the stage alone on the window, nothing of the interface around it.
  if (mode === 'capture') {
    return (
      <div className="h-dvh">
        <Outlet />
      </div>
    )
  }

  const stage = mode === 'stage'
  return (
    <div className={cn('flex min-h-svh flex-col', stage && 'h-svh overflow-hidden')}>
      <TopBar />
      {stage ? (
        // The stage's height: 100% needs a definite box, which a flex-grown one is not: hence the absolute fill.
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <Outlet />
          </div>
        </div>
      ) : (
        <main className="flex flex-1 flex-col p-4 lg:p-6">
          <Outlet />
        </main>
      )}
    </div>
  )
}

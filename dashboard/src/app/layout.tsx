import { NavLink, Outlet, useLocation, useMatches } from 'react-router'
import { ConnectionIndicator } from '@/features/live-feed'
import { cn } from '@/shared/lib/utils'
import { SidebarInset, SidebarProvider } from '@/shared/ui/sidebar'
import { AppSidebar } from './app-sidebar'
import { layoutMode } from './layout-mode'

// The bar the app was born with, across the whole window: the brand, the two surfaces, and whether the feed is
// live. Its words stay in English, as they were.
function TopBar() {
  return (
    <header className="flex shrink-0 items-center gap-6 border-b bg-card px-5 py-3">
      <span className="font-bold tracking-[0.08em]">Sentinel-X</span>
      <nav className="flex flex-1 gap-4">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'text-foreground' : 'text-muted-foreground')}>
          Operator
        </NavLink>
        <NavLink to="/twin" className={({ isActive }) => (isActive ? 'text-foreground' : 'text-muted-foreground')}>
          Digital Twin
        </NavLink>
      </nav>
      <ConnectionIndicator />
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
    <div className={cn('flex flex-col', stage ? 'h-svh overflow-hidden' : 'min-h-svh')}>
      <TopBar />
      <SidebarProvider className="min-h-0 flex-1" style={{ '--sidebar-width': '15rem' } as React.CSSProperties}>
        <AppSidebar />
        <SidebarInset className={cn('min-w-0', stage && 'overflow-hidden')}>
          {stage ? (
            // The stage's height: 100% needs a definite box, which a flex-grown one is not: hence the absolute fill.
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0">
                <Outlet />
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col p-4 lg:p-6">
              <Outlet />
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

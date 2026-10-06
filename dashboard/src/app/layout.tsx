import { NavLink, Outlet, useLocation, useMatches } from 'react-router'
import { ConnectionIndicator } from '@/features/live-feed'
import { cn } from '@/shared/lib/utils'
import { SidebarInset, SidebarProvider, useSidebar } from '@/shared/ui/sidebar'
import { AppSidebar } from './app-sidebar'
import { layoutMode, sidebarOpenFrom } from './layout-mode'

// The bar the app was born with, across the whole window: the menu button, the brand, the two surfaces, and
// whether the feed is live. Its words stay in English, as they were. On a phone the two surfaces are in the
// menu only: the bar keeps the brand and the feed.
function TopBar() {
  const { toggleSidebar, open, openMobile, isMobile } = useSidebar()
  const expanded = isMobile ? openMobile : open

  return (
    <header className="flex shrink-0 items-center gap-3 border-b bg-card px-3 py-3 sm:gap-6 sm:px-5">
      <button
        type="button"
        className="-my-1 rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={expanded ? 'Hide the menu' : 'Show the menu'}
        aria-expanded={expanded}
        title={`${expanded ? 'Hide' : 'Show'} the menu (Ctrl+B)`}
        onClick={toggleSidebar}
      >
        ☰
      </button>
      <span className="font-bold tracking-[0.08em]">Sentinel-X</span>
      <nav className="hidden flex-1 gap-4 md:flex">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'text-foreground' : 'text-muted-foreground')}>
          Operator
        </NavLink>
        <NavLink to="/twin" className={({ isActive }) => (isActive ? 'text-foreground' : 'text-muted-foreground')}>
          Digital Twin
        </NavLink>
      </nav>
      <span className="ml-auto whitespace-nowrap md:ml-0">
        <ConnectionIndicator />
      </span>
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
    // The provider wraps the top bar too: its button opens and closes the sidebar.
    <SidebarProvider
      defaultOpen={sidebarOpenFrom(document.cookie)}
      className={cn('flex-col', stage ? 'h-svh overflow-hidden' : 'min-h-svh')}
      style={{ '--sidebar-width': '15rem' } as React.CSSProperties}
    >
      <TopBar />
      <div className="flex min-h-0 flex-1">
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
            <div className="flex flex-1 flex-col p-3 sm:p-4 lg:p-6">
              <Outlet />
            </div>
          )}
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

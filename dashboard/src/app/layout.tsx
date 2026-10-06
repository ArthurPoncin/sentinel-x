import { Outlet, useLocation, useMatches } from 'react-router'
import { ConnectionIndicator, useLiveFeed } from '@/features/live-feed'
import { StatusBadge } from '@/features/status'
import { cn } from '@/shared/lib/utils'
import { Separator } from '@/shared/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/shared/ui/sidebar'
import { AppSidebar, NAV } from './app-sidebar'
import { layoutMode } from './layout-mode'

function SiteHeader() {
  const { pathname } = useLocation()
  const status = useLiveFeed((state) => state.status)
  const title = NAV.find((item) => item.to === pathname)?.title ?? 'Sentinel-X'

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-4">
          <ConnectionIndicator />
          <StatusBadge status={status} />
        </div>
      </div>
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
    <SidebarProvider
      className={cn(stage && 'h-svh')}
      style={{ '--sidebar-width': '15rem' } as React.CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className={cn(stage && 'overflow-hidden')}>
        <SiteHeader />
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
  )
}

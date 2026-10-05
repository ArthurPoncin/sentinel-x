import { Outlet, useLocation } from 'react-router'
import { ConnectionIndicator, useLiveFeed } from '@/features/live-feed'
import { StatusBadge } from '@/features/status'
import { Separator } from '@/shared/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/shared/ui/sidebar'
import { AppSidebar, NAV } from './app-sidebar'

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
  return (
    <SidebarProvider style={{ '--sidebar-width': '15rem' } as React.CSSProperties}>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col p-4 lg:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

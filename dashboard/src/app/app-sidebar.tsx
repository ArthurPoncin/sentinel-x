import { NavLink, useLocation } from 'react-router'
import { useSignOut } from '@/features/auth'
import { cn } from '@/shared/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/shared/ui/sidebar'

export const NAV = [
  { to: '/', title: 'Operator view' },
  { to: '/twin', title: 'Digital Twin' },
] as const

// The side navigation, under the top bar: the two surfaces, and the way out. Words, no icons. The top bar's
// ☰ (or Ctrl+B) folds it away on a wide screen; on a phone it is a drawer that a choice closes.
export function AppSidebar() {
  const { pathname } = useLocation()
  const signOut = useSignOut()
  const { isMobile, open, setOpenMobile } = useSidebar()
  const close = () => setOpenMobile(false)

  const content = (
    <>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Supervision</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ to, title }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild isActive={pathname === to}>
                    <NavLink to={to} end onClick={close}>
                      {title}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut}>Se déconnecter</SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  )

  // shadcn's off-canvas sidebar is a drawer (Sheet) on a phone.
  if (isMobile) return <Sidebar collapsible="offcanvas">{content}</Sidebar>

  // On a wide screen it stays in the flow, under the top bar (shadcn's own would sit over it): it folds to
  // nothing, and the page takes the room.
  return (
    <div
      className={cn('shrink-0 overflow-hidden transition-[width] duration-200 ease-linear', open ? 'w-(--sidebar-width)' : 'w-0')}
      aria-hidden={!open}
      inert={!open}
    >
      <Sidebar collapsible="none" className="h-full border-r">
        {content}
      </Sidebar>
    </div>
  )
}

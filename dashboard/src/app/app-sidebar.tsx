import { NavLink, useLocation } from 'react-router'
import { useSignOut } from '@/features/auth'
import { useHandSwitch } from '@/features/gestures'
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

// Where the hand control's tutorial is: a screen of its own, there only while the hand control is on.
export const TUTORIAL = '/gestes'

export const NAV = [
  { to: '/', title: 'Operator view', hands: false },
  { to: '/twin', title: 'Digital Twin', hands: false },
  { to: TUTORIAL, title: 'Tutoriel des gestes', hands: true },
] as const

// The screens the menu shows: those of the hand control only while it is on.
export function screens(handsOn: boolean) {
  return NAV.filter(({ hands }) => handsOn || !hands)
}

// The side navigation, under the top bar: the two surfaces, the hand control's tutorial while it is on, and
// the way out. Words, no icons. The top bar's
// ☰ (or Ctrl+B) folds it away on a wide screen; on a phone it is a drawer that a choice closes. At its foot,
// the hand control's switch: off until the Operator has a hand sensor on their desk.
export function AppSidebar() {
  const { pathname } = useLocation()
  const signOut = useSignOut()
  const hands = useHandSwitch()
  const { isMobile, open, setOpenMobile } = useSidebar()
  const close = () => setOpenMobile(false)

  const content = (
    <>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Supervision</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {screens(hands.enabled).map(({ to, title }) => (
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
            <SidebarMenuButton aria-pressed={hands.enabled} onClick={() => hands.setEnabled(!hands.enabled)}>
              Commande gestuelle : {hands.enabled ? 'activée' : 'désactivée'}
            </SidebarMenuButton>
          </SidebarMenuItem>
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

import { NavLink, useLocation } from 'react-router'
import { useAnnouncements } from '@/features/announcements'
import { useSignOut } from '@/features/auth'
import { useHandSwitch } from '@/features/gestures'
import { type Screen, useVoiceSwitch } from '@/features/voice'
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

// Whether the screen at `pathname` is the tutorial, a slash at its end or not: the router shows it for both.
export function inTutorial(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === TUTORIAL
}

// Where the voice control's tutorial is: a screen of its own, there only while the voice control is on.
export const VOICE_TUTORIAL = '/voix'

// Whether the screen at `pathname` is the voice's tutorial, a slash at its end or not.
export function inVoiceTutorial(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === VOICE_TUTORIAL
}

// Where the Digital Twin is.
export const TWIN = '/twin'

// The screens of the app, each with the command that names it to the voice.
export const NAV = [
  { to: '/', title: 'Operator view', of: null, voice: 'operator' },
  { to: TWIN, title: 'Digital Twin', of: null, voice: 'twin' },
  { to: TUTORIAL, title: 'Tutoriel des gestes', of: 'hands', voice: 'tutorial' },
  { to: VOICE_TUTORIAL, title: 'Tutoriel de la voix', of: 'voice', voice: 'voice-tutorial' },
] as const satisfies readonly { to: string; title: string; of: 'hands' | 'voice' | null; voice: Screen }[]

// The screens the menu shows: the tutorial of the hand control only while it is on, and so for the voice's.
export function screens(handsOn: boolean, voiceOn = false) {
  const on = { hands: handsOn, voice: voiceOn }
  return NAV.filter(({ of }) => of === null || on[of])
}

// A switch's state, at the right of its name and smaller: the two hold on one line of the menu.
const STATE = 'ml-auto shrink-0 text-xs text-muted-foreground'

// The side navigation, under the top bar: the two surfaces, the hand control's tutorial while it is on, the
// voice control's next to it while that one is, and the way out. Words, no icons. The top bar's ☰ (or Ctrl+B) folds it away on a wide screen; on a phone it is a
// drawer that a choice closes. At its foot, the hand control's switch, off until the Operator has a hand
// sensor on their desk, the voice control's next to it, off until they want the microphone listened to, and
// the announcements', off until they want the dashboard to talk.
export function AppSidebar() {
  const { pathname } = useLocation()
  const signOut = useSignOut()
  const hands = useHandSwitch()
  const voice = useVoiceSwitch()
  const announcements = useAnnouncements()
  const { isMobile, open, setOpenMobile } = useSidebar()
  const close = () => setOpenMobile(false)

  const content = (
    <>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Supervision</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {screens(hands.enabled, voice.enabled).map(({ to, title }) => (
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
              <span>Commande gestuelle</span>
              <span className={STATE}>{hands.enabled ? 'activée' : 'désactivée'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton aria-pressed={voice.enabled} onClick={() => voice.setEnabled(!voice.enabled)}>
              <span>Commande vocale</span>
              <span className={STATE}>{voice.enabled ? 'activée' : 'désactivée'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-pressed={announcements.enabled}
              onClick={() => announcements.setEnabled(!announcements.enabled)}
            >
              <span>Annonces vocales</span>
              <span className={STATE}>{announcements.enabled ? 'activées' : 'désactivées'}</span>
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

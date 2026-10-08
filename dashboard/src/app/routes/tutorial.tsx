import { GestureTutorial } from '@/features/gestures'

// The hand control's tutorial: the Operator's hands as the sensor sees them, and every gesture the dashboard
// answers to. In the menu only while the hand control is on; opened without it, it says how to switch it on.
export function TutorialRoute() {
  return <GestureTutorial />
}

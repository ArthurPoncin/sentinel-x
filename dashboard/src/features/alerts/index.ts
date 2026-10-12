// Public API of the alerts feature: import from '@/features/alerts', never from its folders.
export { ActiveAlertList, ActiveAlerts } from './components/active-alerts'
export { AlertLog } from './components/alert-log'
export { AlertToasts } from './components/alert-toasts'
export { AttackList, type AttackListProps } from './components/attack-list'
// Pure, for whoever announces the Alerts and the Status to the ear.
export { announcements, sayAlert, type Watched } from './utils/announce'

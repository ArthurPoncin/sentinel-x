import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { Alert } from '@/shared/contract'
import { describeAlert, KIND_LABEL, newlyRaised, SOURCE_LABEL } from '../utils/describe'

const NOTIFY = { critical: toast.error, warning: toast.warning, info: toast.info } as const

// Pops a toast for every Alert newly raised or escalated, so the Operator notices it wherever
// they are looking. Renders nothing itself: the <Toaster /> does.
export function AlertToasts({ alerts }: { alerts: readonly Alert[] }) {
  const previous = useRef<readonly Alert[]>(alerts)

  useEffect(() => {
    for (const alert of newlyRaised(previous.current, alerts)) {
      NOTIFY[alert.severity](KIND_LABEL[alert.kind], {
        id: alert.alert_id,
        description: `${describeAlert(alert)} · ${SOURCE_LABEL[alert.source]}`,
      })
    }
    previous.current = alerts
  }, [alerts])

  return null
}

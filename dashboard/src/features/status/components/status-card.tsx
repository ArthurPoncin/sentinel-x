import { LevelBadge } from '@/shared/components/level-badge'
import type { StatusLevel } from '@/shared/contract'
import { plural, STATUS_LABEL } from '@/shared/lib/labels'
import { toneOfStatus, toneText } from '@/shared/lib/tone'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'

const HEADLINE: Record<StatusLevel, string> = {
  nominal: 'Aucune menace en cours',
  elevated: 'Un avertissement à surveiller',
  critical: 'Intervention requise',
}

interface StatusCardProps {
  status: StatusLevel
  // The Status is the backend's: without the feed, the last one we heard may be stale.
  feed: 'connecting' | 'open' | 'closed'
  activeAlerts: number
}

// The Outpost's headline state, as the Command Post computes it.
export function StatusCard({ status, feed, activeAlerts }: StatusCardProps) {
  const live = feed === 'open'
  const headline = live ? HEADLINE[status] : 'Flux interrompu'

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>Statut</CardDescription>
        <CardTitle className="text-2xl font-semibold @[250px]/card:text-3xl" data-status={live ? status : undefined}>
          {live ? STATUS_LABEL[status] : feed === 'connecting' ? 'Connexion…' : 'Signal perdu'}
        </CardTitle>
        <CardAction>
          {live && <LevelBadge tone={toneOfStatus[status]}>{plural(activeAlerts, 'alerte')}</LevelBadge>}
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="flex gap-2 font-medium">
          <span aria-hidden className={live ? toneText[toneOfStatus[status]] : 'text-muted-foreground'}>
            ●
          </span>
          {headline}
        </div>
        <div className="text-muted-foreground">
          {live ? 'Calculé par le poste de commande' : 'Dernier état inconnu'}
        </div>
      </CardFooter>
    </Card>
  )
}

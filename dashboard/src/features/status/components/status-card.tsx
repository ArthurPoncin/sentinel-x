import { ShieldAlert, ShieldCheck, ShieldOff, ShieldX } from 'lucide-react'
import { LevelBadge } from '@/shared/components/level-badge'
import type { StatusLevel } from '@/shared/contract'
import { plural, STATUS_LABEL } from '@/shared/lib/labels'
import { toneOfStatus, toneText } from '@/shared/lib/tone'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'

const MEANING: Record<StatusLevel, { headline: string; icon: typeof ShieldCheck }> = {
  nominal: { headline: 'Aucune menace en cours', icon: ShieldCheck },
  elevated: { headline: 'Un avertissement à surveiller', icon: ShieldAlert },
  critical: { headline: 'Intervention requise', icon: ShieldX },
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
  const { headline, icon: Icon } = live ? MEANING[status] : { headline: 'Flux interrompu', icon: ShieldOff }

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
          {headline}
          <Icon className={live ? `size-4 ${toneText[toneOfStatus[status]]}` : 'size-4 text-muted-foreground'} />
        </div>
        <div className="text-muted-foreground">
          {live ? 'Calculé par le poste de commande' : 'Dernier état inconnu'}
        </div>
      </CardFooter>
    </Card>
  )
}

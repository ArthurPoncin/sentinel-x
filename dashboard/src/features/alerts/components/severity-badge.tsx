import type { Severity } from '@/shared/contract'
import { toneOfSeverity, toneSurface } from '@/shared/lib/tone'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { SEVERITY_LABEL } from '../utils/describe'

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge variant="outline" className={cn(toneSurface[toneOfSeverity[severity]])}>
      {SEVERITY_LABEL[severity]}
    </Badge>
  )
}

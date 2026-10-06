import { LevelBadge } from '@/shared/components/level-badge'
import type { Severity } from '@/shared/contract'
import { toneOfSeverity } from '@/shared/lib/tone'
import { SEVERITY_LABEL } from '../utils/describe'

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <LevelBadge tone={toneOfSeverity[severity]}>{SEVERITY_LABEL[severity]}</LevelBadge>
}

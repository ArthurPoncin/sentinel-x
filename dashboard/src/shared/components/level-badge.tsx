import { type Tone, toneDot } from '@/shared/lib/tone'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'

// An outline badge with a colored dot: the one place a Status or a severity shows its color.
export function LevelBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 text-muted-foreground', className)}>
      <span className={cn('size-1.5 rounded-full', toneDot[tone])} />
      {children}
    </Badge>
  )
}

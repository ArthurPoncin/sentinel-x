import { BellOff, Lightbulb, LightbulbOff, Siren } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Command } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { sendCommand } from '../api/commands-client'
import { buildCommand, type PresetId, PRESETS } from '../utils/commands'

const LOOK: Record<PresetId, { icon: typeof Siren; className?: string }> = {
  siren: { icon: Siren, className: 'border-critical/50 bg-critical/15 text-critical hover:bg-critical/25' },
  'buzzer-off': { icon: BellOff },
  'led-red': { icon: Lightbulb, className: 'text-critical' },
  'led-green': { icon: Lightbulb, className: 'text-nominal' },
  'leds-off': { icon: LightbulbOff },
}

function describeCommand({ actuator, action, params }: Command): string {
  const detail = params?.pattern ?? params?.led
  return `${actuator} ${action}${detail ? ` (${detail})` : ''}`
}

// Drives the Sentinel's Alarm from afar: every press is a POST /api/v1/commands, and the panel
// says whether the broker took it.
export function ActuatorPanel({ sentinel, className }: { sentinel: string | null; className?: string }) {
  const [pending, setPending] = useState<PresetId | null>(null)
  const [last, setLast] = useState<Command | null>(null)

  const press = async (id: PresetId) => {
    const preset = PRESETS.find((candidate) => candidate.id === id)
    if (!preset) return
    const built = buildCommand(sentinel, preset)
    if (!built.success) return toast.error('Command not sent', { description: built.reason })

    setPending(id)
    const sent = await sendCommand(built.request)
    setPending(null)
    if (!sent.success) return toast.error('Command not delivered', { description: sent.message })
    setLast(sent.command)
    toast.success(`${preset.label}: sent`, { description: `Taken by the broker for ${sent.command.sentinel}` })
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Alarm control</CardTitle>
        <CardDescription>{sentinel ? `Buzzer and LEDs of ${sentinel}` : 'Waiting for a Sentinel…'}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map(({ id, label }) => {
            const { icon: Icon, className: look } = LOOK[id]
            return (
              <Button
                key={id}
                variant="outline"
                className={cn('h-11 justify-start', id === 'siren' && 'col-span-2', look)}
                disabled={sentinel === null || pending !== null}
                onClick={() => press(id)}
              >
                <Icon />
                {pending === id ? 'Sending…' : label}
              </Button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {last
            ? `Last command: ${describeCommand(last)} at ${clock(last.ts)}, id ${last.cmd_id.slice(0, 8)}`
            : 'No command sent from this screen yet.'}
        </p>
      </CardContent>
    </Card>
  )
}

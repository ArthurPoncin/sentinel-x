import { useState } from 'react'
import { toast } from 'sonner'
import type { Command } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { sendCommand } from '../api/commands-client'
import { buildCommand, type Preset, type PresetId, PRESETS } from '../utils/commands'

const byId = (id: PresetId) => PRESETS.find((preset) => preset.id === id) as Preset

// Drives the Sentinel's Alarm from afar: every press is a POST /api/v1/commands, and the panel
// says whether the broker took it.
export function ActuatorPanel({ sentinel, className }: { sentinel: string | null; className?: string }) {
  const [pending, setPending] = useState<PresetId | null>(null)
  const [last, setLast] = useState<{ label: string; command: Command } | null>(null)

  const press = async (preset: Preset) => {
    const built = buildCommand(sentinel, preset)
    if (!built.success) return toast.error('Commande non envoyée', { description: built.reason })

    setPending(preset.id)
    const sent = await sendCommand(built.request)
    setPending(null)
    if (!sent.success) return toast.error('Commande non transmise', { description: sent.message })
    setLast({ label: preset.label, command: sent.command })
    toast.success(preset.label, { description: `Commande transmise à ${sent.command.sentinel}` })
  }

  const button = (id: PresetId, variant: 'outline' | 'destructive' = 'outline', className?: string) => {
    const preset = byId(id)
    return (
      <Button variant={variant} className={className} disabled={sentinel === null || pending !== null} onClick={() => press(preset)}>
        {pending === id ? 'Envoi…' : preset.label}
      </Button>
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Commande de l'alarme</CardTitle>
        <CardDescription>{sentinel ? `Buzzer et LED de ${sentinel}` : 'En attente du Sentinel…'}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {button('siren', 'destructive', 'w-full')}
        {button('buzzer-off', 'outline', 'w-full')}
        <div className="grid grid-cols-2 gap-2">
          {button('led-red')}
          {button('led-green')}
        </div>
        {button('leds-off', 'outline', 'w-full')}
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        {last
          ? `Dernière commande : ${last.label.toLowerCase()} à ${clock(last.command.ts)}`
          : 'Aucune commande envoyée depuis cet écran.'}
      </CardFooter>
    </Card>
  )
}

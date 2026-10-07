import { useState } from 'react'
import { toast } from 'sonner'
import type { Command } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { firePreset } from '../api/commands-client'
import { type Preset, type PresetId, PRESETS } from '../utils/commands'

const byId = (id: PresetId) => PRESETS.find((preset) => preset.id === id) as Preset

// Drives the Sentinel's Alarm from afar: every press is a POST /api/v1/commands, and the panel
// says whether the broker took it.
export function ActuatorPanel({ sentinel, className }: { sentinel: string | null; className?: string }) {
  const [pending, setPending] = useState<PresetId | null>(null)
  const [last, setLast] = useState<{ label: string; command: Command } | null>(null)

  const press = async (preset: Preset) => {
    setPending(preset.id)
    const fired = await firePreset(sentinel, preset.id)
    setPending(null)
    if (!fired.success) return toast.error(fired.title, { description: fired.description })
    setLast({ label: fired.label, command: fired.command })
    toast.success(fired.label, { description: `Commande transmise à ${fired.command.sentinel}` })
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
        <CardDescription>{sentinel ? `Sirène de ${sentinel}` : 'En attente du Sentinel…'}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {button('siren', 'destructive', 'w-full')}
        {button('siren-off', 'outline', 'w-full')}
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        {last
          ? `Dernière commande : ${last.label.toLowerCase()} à ${clock(last.command.ts)}`
          : 'Aucune commande envoyée depuis cet écran.'}
      </CardFooter>
    </Card>
  )
}

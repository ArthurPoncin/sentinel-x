import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { CameraBadge, CameraFeed, type Intrusion, useCamera } from './camera-feed'

// The live camera as a card of the Operator's screen.
export function CameraPanel({ intrusion, className }: { intrusion: Intrusion | null; className?: string }) {
  const camera = useCamera()

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Caméra</CardTitle>
        <CardDescription>Détection de personnes par l'IA vision</CardDescription>
        <CardAction>
          <CameraBadge camera={camera} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <CameraFeed camera={camera} intrusion={intrusion} />
      </CardContent>
    </Card>
  )
}

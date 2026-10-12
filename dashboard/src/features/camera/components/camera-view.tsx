import { CameraBadge, CameraFeed, type Intrusion, useCamera } from './camera-feed'

// The live camera with no card around it, for what brings its own frame: the same picture and the same marks
// as the panel. A replay has no picture to show, the stream is not recorded: `replayed` says so instead, and
// asks nothing of the camera.
export function CameraView({ intrusion, replayed = false }: { intrusion: Intrusion | null; replayed?: boolean }) {
  if (replayed) {
    return (
      <p className="flex aspect-4/3 items-center justify-center rounded-lg border bg-muted/40 px-4 text-center text-sm text-muted-foreground">
        Replay : pas d'image rejouée. La caméra ne se voit qu'en direct.
      </p>
    )
  }
  return <LiveView intrusion={intrusion} />
}

function LiveView({ intrusion }: { intrusion: Intrusion | null }) {
  const camera = useCamera()
  return (
    <div className="flex flex-col gap-2">
      <CameraFeed camera={camera} intrusion={intrusion} />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        Détection de personnes par l'IA vision
        <CameraBadge camera={camera} />
      </div>
    </div>
  )
}

import { describe, expect, it } from 'vitest'
import { stateAfter } from '@/features/live-feed'
import { framesAt, scenario } from '@/features/replay'
import { toScene } from '@/features/twin'

// What the Twin route does with a replay: the frames received by a second, folded the way the live feed folds
// them, mapped to the scene. The Twin reacts to the replayed frames as it does to the live ones.
const START = Date.parse('2026-10-06T09:00:00Z')
const sceneAt = (second: number) => {
  const replay = scenario(START)
  return toScene(stateAfter(framesAt(replay, START + second * 1000)))
}

describe('the Twin on a replay', () => {
  it('is calm before the Incident opens', () => {
    const scene = sceneAt(2)

    expect(scene.status.level).toBe('nominal')
    expect(scene.enclosure.alarm).toBeNull()
  })

  it('sounds the Alarm and blinks the PIR as the replayed gas and presence come', () => {
    const scene = sceneAt(15)

    expect(scene.status.level).toBe('elevated')
    expect(scene.enclosure.alarm?.severity).toBe('warning')
    expect(scene.presence.active).toBe(true)
  })

  it('turns critical at the gas peak, the Enclosure glowing with it', () => {
    const scene = sceneAt(27)

    expect(scene.status.level).toBe('critical')
    expect(scene.enclosure.alarm?.severity).toBe('critical')
    expect(scene.enclosure.glow).toBe(1)
  })

  it('is back to nominal once every Alert is cleared', () => {
    const scene = sceneAt(60)

    expect(scene.status.level).toBe('nominal')
    expect(scene.enclosure.alarm).toBeNull()
    expect(scene.presence.active).toBe(false)
  })

  it('never shows a signal lost: a replay does not depend on the network', () => {
    expect(sceneAt(30).signalLost).toBe(false)
  })
})

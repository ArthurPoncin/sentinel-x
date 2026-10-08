import { describe, expect, it } from 'vitest'
import type { Reading } from './interpret'
import { completed, doing, LESSONS, lessonOf } from './lessons'
import { modelHand } from './model-hand'
import { hammerOf, HAMMER_BACK, isOpen, poseOf } from './pose'
import { flat, handLines } from './skeleton'

const NOTHING: Reading = { steer: null, wind: null, confirming: null, stretch: null, aim: null, shot: null }

describe('modelHand', () => {
  it('shows each pose as the dashboard reads it', () => {
    expect(poseOf(modelHand('flat'))).toBe('flat')
    expect(poseOf(modelHand('fist'))).toBe('fist')
    expect(poseOf(modelHand('edge'))).toBe('edge')
    expect(poseOf(modelHand('thumb-up'))).toBe('thumb-up')
    expect(poseOf(modelHand('thumb-down'))).toBe('thumb-down')
    expect(poseOf(modelHand('point'))).toBe('aim')
  })

  it('points with the thumb drawn back', () => {
    expect(hammerOf(modelHand('point'))).toBeLessThanOrEqual(HAMMER_BACK)
  })

  it('has a left hand that is the right one in a mirror, where it is asked', () => {
    const right = modelHand('flat', { palm: [80, 200, 0] })
    const left = modelHand('flat', { palm: [-80, 200, 0], side: 'left', id: 2 })

    expect(left.side).toBe('left')
    expect(isOpen(left)).toBe(true)
    expect(left.fingers[0].joints[4][0]).toBeCloseTo(-right.fingers[0].joints[4][0])
    expect(left.fingers[0].joints[4][0]).toBeGreaterThan(left.palm[0])
  })
})

describe('handLines', () => {
  it('draws every bone of a hand, and its palm', () => {
    expect(handLines(modelHand('flat'))).toHaveLength(5 * 3 + 3 + 4)
  })

  it('lays a point flat from above, from the front and from the side', () => {
    expect(flat([10, 200, -30], 'top')).toEqual([10, -30])
    expect(flat([10, 200, -30], 'front')).toEqual([10, -200])
    expect(flat([10, 200, -30], 'side')).toEqual([30, -200])
  })
})

describe('the lessons', () => {
  it('have a hand to show each, but for the one that is not told', () => {
    for (const lesson of LESSONS) expect(lesson.hands.length > 0).toBe(lesson.secret === undefined)
    expect(LESSONS.find(({ id }) => id === 'spread')?.hands).toHaveLength(2)
  })

  it('do not tell the secret before it is found', () => {
    const secret = LESSONS.find(({ id }) => id === 'secret')

    expect(`${secret?.title} ${secret?.how} ${secret?.does}`).not.toMatch(/pistolet|pouce|tire/i)
  })

  it('are completed by a pose held for those that only take one', () => {
    for (const pose of ['flat', 'spread', 'fist', 'aim'] as const) {
      expect(completed({ pose, action: null, shot: false })).toEqual([pose])
    }
  })

  it('are completed by what was asked for, for those that ask for something', () => {
    expect(completed({ pose: 'edge', action: null, shot: false })).toEqual([])
    expect(completed({ pose: 'thumb-up', action: null, shot: false })).toEqual([])
    expect(completed({ pose: 'none', action: 'page-left', shot: false })).toEqual(['edge'])
    expect(completed({ pose: 'none', action: 'page-right', shot: false })).toEqual(['edge'])
    expect(completed({ pose: 'none', action: 'all-clear', shot: false })).toEqual(['thumb-up'])
    expect(completed({ pose: 'none', action: 'alarm', shot: false })).toEqual(['thumb-down'])
    expect(completed({ pose: 'none', action: null, shot: true })).toEqual(['secret'])
  })

  it('light the lesson the hand is on', () => {
    expect(lessonOf('flat')).toBe('flat')
    expect(lessonOf('thumb-down')).toBe('thumb-down')
    expect(lessonOf('none')).toBeNull()
  })
})

describe('doing', () => {
  it('says which way a flat hand takes the camera, and that it rests at the middle', () => {
    expect(doing('flat', { ...NOTHING, steer: { turn: 0.5, tilt: 0, zoom: -1 } })).toBe('Caméra : tourne à droite 50 % · dézoome 100 %')
    expect(doing('flat', { ...NOTHING, steer: { turn: 0, tilt: 0, zoom: 0 } })).toMatch(/au repos/)
  })

  it('says how far two hands have stretched the view', () => {
    expect(doing('spread', { ...NOTHING, stretch: 1.5 })).toBe('Zoom × 1.50')
  })

  it('says which way a fist winds a replay', () => {
    expect(doing('fist', { ...NOTHING, wind: -0.4 })).toBe('Replay : recule 40 %')
    expect(doing('fist', { ...NOTHING, wind: 0 })).toMatch(/Caméra tenue/)
  })

  it('says how far along a thumb is, then that it was read', () => {
    expect(doing('thumb-up', { ...NOTHING, confirming: { pose: 'thumb-up', progress: 0.5 } })).toBe('Couper la sirène : tenez encore, 50 %')
    expect(doing('thumb-down', { ...NOTHING, confirming: { pose: 'thumb-down', progress: 1 } })).toBe('Déclencher la sirène : geste reconnu')
  })

  it('says where the sight is', () => {
    const aim = { x: 0.6, y: -0.5, cocked: false, from: [0, 0, 0] as [number, number, number] }

    expect(doing('aim', { ...NOTHING, aim })).toBe('Viseur : à droite, en bas')
  })

  it('says so when the hand is in no pose it knows', () => {
    expect(doing('none', NOTHING)).toBe('Aucune pose reconnue')
  })
})

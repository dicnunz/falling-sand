import { afterEach, expect, it, vi } from 'vitest'
import { createEmptySnapshot, hydrateSnapshot, serializeSnapshot, setCell } from '@/sim/scene'
import { stepSimulation } from '@/sim/simulation'
import { MATERIALS, type WorkerFrameResponse, type WorkerRequest } from '@/sim/types'

afterEach(() => vi.unstubAllGlobals())

it('restores tick and seed exactly, holds the frame while paused, and continues deterministically', async () => {
  let receive!: (event: { data: WorkerRequest }) => void
  let tick!: () => void
  const frames: WorkerFrameResponse[] = []
  vi.stubGlobal('self', {
    postMessage: (frame: WorkerFrameResponse) => frames.push(frame),
    addEventListener: (_type: string, listener: typeof receive) => { receive = listener },
    setTimeout: (callback: () => void) => { tick = callback },
  })
  await import('@/workers/simulation.worker')
  const snapshot = createEmptySnapshot(168, 168, 0xf123abcd)
  setCell(snapshot, 30, 40, MATERIALS.WATER, 203)
  snapshot.tick = 237
  receive({ data: { type: 'load-scene', snapshot: serializeSnapshot(snapshot), paused: true, requestId: 5 } })
  expect(frames.at(-1)?.requestId).toBe(5)
  expect(hydrateSnapshot(frames.at(-1)!.snapshot)).toEqual(snapshot)
  tick()
  receive({ data: { type: 'request-frame', requestId: 6 } })
  expect(hydrateSnapshot(frames.at(-1)!.snapshot)).toEqual(snapshot)
  receive({ data: { type: 'step-burst', frames: 1, requestId: 7 } })
  expect(hydrateSnapshot(frames.at(-1)!.snapshot)).toEqual(stepSimulation(snapshot))
  expect(frames.at(-1)?.requestId).toBe(7)
})

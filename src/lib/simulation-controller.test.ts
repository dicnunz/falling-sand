import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSimulationController } from '@/lib/simulation-controller'
import { createEmptySnapshot, serializeSnapshot, summarizeSnapshot } from '@/sim/scene'
import type { WorkerRequest } from '@/sim/types'

class TestWorker extends EventTarget {
  static current: TestWorker
  messages: WorkerRequest[] = []
  terminate = vi.fn()
  constructor() { super(); TestWorker.current = this }
  postMessage(message: WorkerRequest) { this.messages.push(message) }
  frame(tick: number, requestId?: number) {
    const snapshot = createEmptySnapshot(168, 168, 41)
    snapshot.tick = tick
    this.dispatchEvent(new MessageEvent('message', { data: { type: 'frame', snapshot: serializeSnapshot(snapshot), metrics: summarizeSnapshot(snapshot), requestId } }))
  }
}

beforeEach(() => { vi.stubGlobal('Worker', TestWorker); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('worker snapshot requests', () => {
  it('captures a fresh correlated response, never the previous periodic frame', async () => {
    const controller = createSimulationController()
    const worker = TestWorker.current
    worker.frame(10)
    const capture = controller.captureSnapshot()
    const request = worker.messages.at(-1)!
    expect(request.type).toBe('request-frame')
    worker.frame(11)
    let resolved = false
    void capture.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    if (request.type !== 'request-frame') throw new Error('Expected snapshot request')
    worker.frame(12, request.requestId)
    expect((await capture).snapshot.tick).toBe(12)
    controller.destroy()
  })

  it('loads exact state with an atomic paused flag and waits for acknowledgement', async () => {
    const controller = createSimulationController()
    const source = createEmptySnapshot(168, 168, 23)
    source.tick = 305
    const load = controller.loadScene(source, true)
    const request = TestWorker.current.messages.at(-1)!
    expect(request.type).toBe('load-scene')
    if (request.type !== 'load-scene') throw new Error('Expected load')
    expect(request.paused).toBe(true)
    expect(request.snapshot.tick).toBe(305)
    expect(source.materials.byteLength).toBe(168 * 168)
    TestWorker.current.frame(305, request.requestId)
    expect((await load).snapshot.tick).toBe(305)
    controller.destroy()
  })

  it('rejects pending saves on worker failure and reports the failure to the UI', async () => {
    const controller = createSimulationController()
    const onError = vi.fn()
    controller.subscribeError(onError)
    const capture = controller.captureSnapshot()
    const rejection = expect(capture).rejects.toThrow('stopped unexpectedly')
    TestWorker.current.dispatchEvent(new Event('error'))
    await rejection
    expect(onError).toHaveBeenCalledOnce()
    await expect(controller.captureSnapshot()).rejects.toThrow('stopped unexpectedly')
    controller.destroy()
  })

  it('rejects unanswered requests instead of leaving Save disabled forever', async () => {
    const controller = createSimulationController()
    const rejection = expect(controller.captureSnapshot()).rejects.toThrow('did not respond')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejection
    controller.destroy()
  })

  it('rejects pending requests when the workspace closes', async () => {
    const controller = createSimulationController()
    const rejection = expect(controller.stepBurst(1)).rejects.toThrow('closed')
    controller.destroy()
    await rejection
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
  })
})

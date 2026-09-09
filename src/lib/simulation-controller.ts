import { hydrateSnapshot, serializeSnapshot } from '@/sim/scene'
import type { BrushEvent, SimulationMetrics, SimulationSnapshot, WorkerRequest, WorkerResponse } from '@/sim/types'

export interface FramePayload {
  snapshot: SimulationSnapshot
  metrics: SimulationMetrics
  requestId?: number
}

export interface SimulationController {
  loadScene: (snapshot: SimulationSnapshot, paused: boolean) => Promise<FramePayload>
  setPaused: (paused: boolean) => void
  applyBrush: (brush: BrushEvent) => void
  requestFrame: () => void
  captureSnapshot: () => Promise<FramePayload>
  stepBurst: (frames: number) => Promise<FramePayload>
  subscribeFrame: (listener: (payload: FramePayload) => void) => () => void
  subscribeError: (listener: (error: Error) => void) => () => void
  getLatestPayload: () => FramePayload | null
  destroy: () => void
}

export function createSimulationController(): SimulationController {
  const worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' })
  const listeners = new Set<(payload: FramePayload) => void>()
  const errorListeners = new Set<(error: Error) => void>()
  const pending = new Map<number, { resolve: (payload: FramePayload) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let requestId = 0
  let latestPayload: FramePayload | null = null
  let failure: Error | null = null

  function fail(error: Error): void {
    failure = error
    pending.forEach(({ reject, timer }) => {
      clearTimeout(timer)
      reject(error)
    })
    pending.clear()
    errorListeners.forEach((listener) => listener(error))
  }

  worker.addEventListener('error', () => fail(new Error('The simulation stopped unexpectedly. Reload Falling Sand to restart it.')))
  worker.addEventListener('messageerror', () => fail(new Error('The simulation returned an unreadable frame. Reload Falling Sand to restart it.')))
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    if (message.type !== 'frame' || failure) return
    const payload: FramePayload = {
      snapshot: hydrateSnapshot(message.snapshot),
      metrics: message.metrics,
      requestId: message.requestId,
    }
    latestPayload = payload
    listeners.forEach((listener) => listener(payload))
    if (message.requestId !== undefined) {
      const request = pending.get(message.requestId)
      if (request) {
        clearTimeout(request.timer)
        pending.delete(message.requestId)
        request.resolve(payload)
      }
    }
  })

  function post(message: WorkerRequest, transfer: Transferable[] = []): void {
    if (!failure) worker.postMessage(message, transfer)
  }

  function request(message: (id: number) => WorkerRequest, transfer: Transferable[] = []): Promise<FramePayload> {
    if (failure) return Promise.reject(failure)
    return new Promise((resolve, reject) => {
      const id = ++requestId
      const timer = setTimeout(() => {
        // Late load acknowledgements cannot safely reconcile the visible scene.
        fail(new Error('The simulation did not respond. Reload Falling Sand to restart it.'))
      }, 10_000)
      pending.set(id, { resolve, reject, timer })
      try {
        post(message(id), transfer)
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error instanceof Error ? error : new Error('The simulation request failed.'))
      }
    })
  }

  return {
    loadScene(snapshot, paused) {
      const serialized = serializeSnapshot(snapshot)
      return request((id) => ({ type: 'load-scene', snapshot: serialized, paused, requestId: id }), [serialized.materials, serialized.charge])
    },
    setPaused: (paused) => post({ type: 'set-paused', paused }),
    applyBrush: (brush) => post({ type: 'apply-brush', brush }),
    requestFrame: () => post({ type: 'request-frame' }),
    captureSnapshot: () => request((id) => ({ type: 'request-frame', requestId: id })),
    stepBurst: (frames) => request((id) => ({ type: 'step-burst', frames, requestId: id })),
    subscribeFrame(listener) {
      listeners.add(listener)
      if (latestPayload) listener(latestPayload)
      return () => { listeners.delete(listener) }
    },
    subscribeError(listener) {
      errorListeners.add(listener)
      if (failure) listener(failure)
      return () => { errorListeners.delete(listener) }
    },
    getLatestPayload: () => latestPayload,
    destroy() {
      errorListeners.clear()
      listeners.clear()
      fail(new Error('The simulation was closed.'))
      worker.terminate()
    },
  }
}

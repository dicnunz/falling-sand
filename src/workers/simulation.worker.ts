/// <reference lib="webworker" />

import { applyBrush } from '@/sim/tools'
import { createEmptySnapshot, hydrateSnapshot, serializeSnapshot, summarizeSnapshot } from '@/sim/scene'
import { GRID_SIZE, RENDER_FPS, SIMULATION_FPS, type WorkerFrameResponse, type WorkerRequest } from '@/sim/types'
import { stepSimulation } from '@/sim/simulation'

const workerScope = self as DedicatedWorkerGlobalScope

let currentSnapshot = createEmptySnapshot(GRID_SIZE, GRID_SIZE, 1)
let paused = false
let lastFrameSentAt = 0

function emitFrame(requestId?: number): void {
  const snapshot = serializeSnapshot(currentSnapshot)
  const payload: WorkerFrameResponse = {
    type: 'frame',
    snapshot,
    metrics: summarizeSnapshot(currentSnapshot),
    requestId,
  }

  workerScope.postMessage(payload, [snapshot.materials, snapshot.charge])
}

function tick(): void {
  if (!paused) {
    currentSnapshot = stepSimulation(currentSnapshot)
    const now = performance.now()
    if (now - lastFrameSentAt >= 1000 / RENDER_FPS) {
      lastFrameSentAt = now
      emitFrame()
    }
  }

  workerScope.setTimeout(tick, 1000 / SIMULATION_FPS)
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  switch (message.type) {
    case 'load-scene':
      currentSnapshot = hydrateSnapshot(message.snapshot)
      paused = message.paused
      lastFrameSentAt = 0
      emitFrame(message.requestId)
      break

    case 'set-paused':
      paused = message.paused
      emitFrame()
      break

    case 'apply-brush':
      currentSnapshot = applyBrush(currentSnapshot, message.brush)
      emitFrame()
      break

    case 'step-burst':
      for (let step = 0; step < message.frames; step += 1) {
        currentSnapshot = stepSimulation(currentSnapshot)
      }
      emitFrame(message.requestId)
      break

    case 'request-frame':
      emitFrame(message.requestId)
      break

    default:
      break
  }
})

emitFrame()
tick()

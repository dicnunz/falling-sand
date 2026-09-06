export const GRID_SIZE = 168
export const DISPLAY_SIZE = 960
export const SIMULATION_FPS = 60
export const RENDER_FPS = 30
export const RECORDING_DURATION_MS = 8_000

export const MATERIALS = {
  EMPTY: 0,
  SAND: 1,
  WATER: 2,
  STONE: 3,
  EMBER: 4,
  SMOKE: 5,
} as const

export type MaterialId = (typeof MATERIALS)[keyof typeof MATERIALS]
export type PresetId = 'melt' | 'flood' | 'burn'
export type ToolId = 'push' | 'spark' | 'erase'

export interface SimulationSnapshot {
  width: number
  height: number
  materials: Uint8Array
  charge: Uint8Array
  tick: number
  seed: number
}

export interface SimulationMetrics {
  activeCells: number
  sandCells: number
  waterCells: number
  stoneCells: number
  emberCells: number
  smokeCells: number
  tick: number
}

export interface BrushEvent {
  tool: ToolId
  x: number
  y: number
  dx: number
  dy: number
  radius: number
  intensity: number
}

export interface TransferableSnapshot {
  width: number
  height: number
  materials: ArrayBuffer
  charge: ArrayBuffer
  tick: number
  seed: number
}

export type WorkerRequest =
  | { type: 'load-scene'; snapshot: TransferableSnapshot; paused: boolean; requestId: number }
  | { type: 'set-paused'; paused: boolean }
  | { type: 'apply-brush'; brush: BrushEvent }
  | { type: 'step-burst'; frames: number; requestId: number }
  | { type: 'request-frame'; requestId?: number }

export interface WorkerFrameResponse {
  type: 'frame'
  snapshot: TransferableSnapshot
  metrics: SimulationMetrics
  requestId?: number
}

export type WorkerResponse = WorkerFrameResponse

export interface DemoScene {
  id: string
  name: string
  description: string
  src: string
}

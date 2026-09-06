import { GRID_SIZE, MATERIALS, type PresetId, type SimulationSnapshot, type ToolId } from '@/sim/types'

export const MAX_SCENE_FILE_BYTES = 1_048_576
const FORMAT = 'pixelmelt.scene'
const VERSION = 1

export interface SceneSettings {
  sourceLabel: string
  selectedDemoId: string
  activePreset: PresetId
  activeTool: ToolId
  brushSize: number
  brushIntensity: number
}

export interface SavedScene {
  snapshot: SimulationSnapshot
  baseSnapshot: SimulationSnapshot
  settings: SceneSettings
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`This scene has invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`This scene has an invalid ${label}.`)
  }
  return value
}

function bytes(value: unknown, max: number, label: string): Uint8Array {
  if (!Array.isArray(value) || value.length !== GRID_SIZE * GRID_SIZE) {
    throw new Error(`This scene has an incomplete ${label} map.`)
  }
  for (const item of value) integer(item, 0, max, label)
  return Uint8Array.from(value)
}

function readSnapshot(value: unknown): SimulationSnapshot {
  const data = object(value, 'simulation data')
  if (data.width !== GRID_SIZE || data.height !== GRID_SIZE) {
    throw new Error(`This scene must use a ${GRID_SIZE} × ${GRID_SIZE} grid.`)
  }
  return {
    width: GRID_SIZE,
    height: GRID_SIZE,
    materials: bytes(data.materials, MATERIALS.SMOKE, 'material'),
    charge: bytes(data.charge, 255, 'charge'),
    tick: integer(data.tick, 0, Number.MAX_SAFE_INTEGER - 1, 'tick'),
    seed: integer(data.seed, 0, 0xffffffff, 'seed'),
  }
}

function readSettings(value: unknown): SceneSettings {
  const data = object(value, 'settings')
  if (typeof data.sourceLabel !== 'string' || !data.sourceLabel.trim() || data.sourceLabel.length > 120 || Array.from(data.sourceLabel).some((character) => character.charCodeAt(0) < 32)) {
    throw new Error('This scene has an invalid source name.')
  }
  if (typeof data.selectedDemoId !== 'string' || data.selectedDemoId.length > 80) {
    throw new Error('This scene has an invalid source reference.')
  }
  if (data.activePreset !== 'melt' && data.activePreset !== 'flood' && data.activePreset !== 'burn') {
    throw new Error('This scene uses an unknown preset.')
  }
  if (data.activeTool !== 'push' && data.activeTool !== 'spark' && data.activeTool !== 'erase') {
    throw new Error('This scene uses an unknown tool.')
  }
  if (typeof data.brushIntensity !== 'number' || !Number.isFinite(data.brushIntensity) || data.brushIntensity < 0.35 || data.brushIntensity > 1) {
    throw new Error('This scene has an invalid brush force.')
  }
  return {
    sourceLabel: data.sourceLabel,
    selectedDemoId: data.selectedDemoId,
    activePreset: data.activePreset,
    activeTool: data.activeTool,
    brushSize: integer(data.brushSize, 2, 14, 'brush size'),
    brushIntensity: data.brushIntensity,
  }
}

export function parseSceneFile(text: string): SavedScene {
  if (text.length > MAX_SCENE_FILE_BYTES) throw new Error('Scene files must be smaller than 1 MB.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid scene JSON. Open a .pixelmelt file saved by PixelMelt.')
  }
  const data = object(parsed, 'file data')
  if (data.format !== FORMAT) throw new Error('This is not a PixelMelt scene file.')
  if (data.version !== VERSION) throw new Error('This scene version is not supported by this PixelMelt build.')
  return {
    snapshot: readSnapshot(data.snapshot),
    baseSnapshot: readSnapshot(data.baseSnapshot),
    settings: readSettings(data.settings),
  }
}

export function serializeSceneFile(scene: SavedScene): string {
  const encode = (snapshot: SimulationSnapshot) => ({
    ...snapshot,
    materials: Array.from(snapshot.materials),
    charge: Array.from(snapshot.charge),
  })
  const text = JSON.stringify({
    format: FORMAT,
    version: VERSION,
    snapshot: encode(scene.snapshot),
    baseSnapshot: encode(scene.baseSnapshot),
    settings: scene.settings,
  })
  // Export and import share one contract, including bounds and versioning.
  parseSceneFile(text)
  return text
}

export async function readSceneFile(file: File): Promise<SavedScene> {
  if (file.size > MAX_SCENE_FILE_BYTES) throw new Error('Scene files must be smaller than 1 MB.')
  return parseSceneFile(await file.text())
}

export function sceneFilename(sourceLabel: string): string {
  const slug = sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `pixelmelt-${slug || 'untitled'}.pixelmelt`
}

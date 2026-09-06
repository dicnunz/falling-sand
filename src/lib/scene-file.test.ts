import { describe, expect, it, vi } from 'vitest'
import { createEmptySnapshot, setCell } from '@/sim/scene'
import { buildPresetScene } from '@/sim/presets'
import { stepSimulation } from '@/sim/simulation'
import { applyBrush } from '@/sim/tools'
import { GRID_SIZE, MATERIALS } from '@/sim/types'
import { MAX_SCENE_FILE_BYTES, parseSceneFile, readSceneFile, sceneFilename, serializeSceneFile, type SavedScene } from '@/lib/scene-file'

type SceneJSON = {
  version: number
  format: string
  snapshot: { width: number; materials: unknown[]; charge: unknown[]; tick: number; seed: number }
  baseSnapshot?: { materials: unknown[] }
  settings: { activePreset: string; activeTool: string; brushSize: number; brushIntensity: number; sourceLabel: string }
}

function scene(): SavedScene {
  const baseSnapshot = createEmptySnapshot(GRID_SIZE, GRID_SIZE, 0xf123abcd)
  for (let x = 60; x < 80; x += 1) {
    setCell(baseSnapshot, x, 75, MATERIALS.SAND, 220)
    setCell(baseSnapshot, x, 100, MATERIALS.STONE, 20)
  }
  let snapshot = buildPresetScene(baseSnapshot, 'flood')
  for (let tick = 0; tick < 7; tick += 1) snapshot = stepSimulation(snapshot)
  snapshot = applyBrush(snapshot, { tool: 'spark', x: 70, y: 80, dx: 0, dy: 0, radius: 6, intensity: 0.72 })
  return { snapshot, baseSnapshot, settings: { sourceLabel: 'A scene to continue', selectedDemoId: '', activePreset: 'flood', activeTool: 'spark', brushSize: 6, brushIntensity: 0.72 } }
}

describe('scene files', () => {
  it('preserves the edited current state, original source, every setting, and deterministic continuation', () => {
    const original = scene()
    const restored = parseSceneFile(serializeSceneFile(original))
    expect(restored).toEqual(original)
    expect(restored.snapshot.tick).toBe(7)
    expect(restored.snapshot.materials).not.toBe(original.snapshot.materials)
    let before = original.snapshot
    let after = restored.snapshot
    for (let tick = 0; tick < 12; tick += 1) { before = stepSimulation(before); after = stepSimulation(after) }
    expect(after).toEqual(before)
    expect(buildPresetScene(restored.baseSnapshot, 'burn')).toEqual(buildPresetScene(original.baseSnapshot, 'burn'))
  })

  it.each([
    ['unsupported version', (data: SceneJSON) => { data.version = 999 }],
    ['wrong format', (data: SceneJSON) => { data.format = 'image' }],
    ['wrong dimensions', (data: SceneJSON) => { data.snapshot.width = 100_000 }],
    ['truncated map', (data: SceneJSON) => { data.snapshot.materials.pop() }],
    ['unknown material', (data: SceneJSON) => { data.snapshot.materials[0] = 6 }],
    ['fractional material', (data: SceneJSON) => { data.snapshot.materials[0] = 1.5 }],
    ['negative charge', (data: SceneJSON) => { data.snapshot.charge[0] = -1 }],
    ['overflowing charge', (data: SceneJSON) => { data.snapshot.charge[0] = 256 }],
    ['null charge', (data: SceneJSON) => { data.snapshot.charge[0] = null }],
    ['negative tick', (data: SceneJSON) => { data.snapshot.tick = -1 }],
    ['unsafe tick', (data: SceneJSON) => { data.snapshot.tick = Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid seed', (data: SceneJSON) => { data.snapshot.seed = 0x100000000 }],
    ['missing original source', (data: SceneJSON) => { delete data.baseSnapshot }],
    ['corrupt original source', (data: SceneJSON) => { data.baseSnapshot!.materials = [] }],
    ['invalid preset', (data: SceneJSON) => { data.settings.activePreset = 'unknown' }],
    ['invalid tool', (data: SceneJSON) => { data.settings.activeTool = 'unknown' }],
    ['invalid radius', (data: SceneJSON) => { data.settings.brushSize = 15 }],
    ['invalid force', (data: SceneJSON) => { data.settings.brushIntensity = 4 }],
    ['empty name', (data: SceneJSON) => { data.settings.sourceLabel = ' ' }],
  ])('rejects %s before constructing a usable scene', (_label, corrupt) => {
    const data = JSON.parse(serializeSceneFile(scene()))
    corrupt(data)
    expect(() => parseSceneFile(JSON.stringify(data))).toThrow()
  })

  it('gives useful errors for malformed JSON and oversized files without reading them', async () => {
    expect(() => parseSceneFile('{broken')).toThrow('not valid scene JSON')
    const text = vi.fn()
    await expect(readSceneFile({ size: MAX_SCENE_FILE_BYTES + 1, text } as unknown as File)).rejects.toThrow('smaller than 1 MB')
    expect(text).not.toHaveBeenCalled()
  })

  it('uses safe filenames even for punctuation-only source names', () => {
    expect(sceneFilename('Tidal Idol / final')).toBe('pixelmelt-tidal-idol-final.pixelmelt')
    expect(sceneFilename('☄')).toBe('pixelmelt-untitled.pixelmelt')
  })
})

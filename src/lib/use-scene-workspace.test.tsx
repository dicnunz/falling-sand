// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSceneWorkspace } from '@/lib/use-scene-workspace'
import { usePixelMeltStore } from '@/store/use-pixelmelt-store'
import { rasterizeUrlToImageData } from '@/lib/image-raster'
import { createSimulationController } from '@/lib/simulation-controller'
import { createEmptySnapshot, summarizeSnapshot } from '@/sim/scene'
import { serializeSceneFile, type SavedScene } from '@/lib/scene-file'
import type { FramePayload, SimulationController } from '@/lib/simulation-controller'

vi.mock('@/lib/image-raster', () => ({ rasterizeUrlToImageData: vi.fn(), rasterizeFileToImageData: vi.fn() }))
vi.mock('@/lib/simulation-controller', () => ({ createSimulationController: vi.fn() }))

const demo = { id: 'first', name: 'First source', description: '', src: '/first.svg' }
const initialState = usePixelMeltStore.getInitialState()
let workspace!: ReturnType<typeof useSceneWorkspace>
let controller: SimulationController
let root: Root
let container: HTMLDivElement

function Harness() {
  const current = useSceneWorkspace(demo)
  const state = usePixelMeltStore()
  useEffect(() => { workspace = current }, [current])
  return <div>{state.sourceLabel} · {state.sceneStatus} · {state.lastError}</div>
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  usePixelMeltStore.setState(initialState, true)
  const frame = (snapshot = createEmptySnapshot(168, 168)) => ({ snapshot, metrics: summarizeSnapshot(snapshot) })
  controller = {
    loadScene: vi.fn(async (snapshot) => frame(snapshot)), setPaused: vi.fn(), applyBrush: vi.fn(), requestFrame: vi.fn(),
    captureSnapshot: vi.fn(async () => frame()), stepBurst: vi.fn(async () => frame()),
    subscribeFrame: vi.fn(() => () => {}), subscribeError: vi.fn(() => () => {}), getLatestPayload: vi.fn(() => frame()), destroy: vi.fn(),
  }
  vi.mocked(createSimulationController).mockReturnValue(controller)
  vi.mocked(rasterizeUrlToImageData).mockResolvedValue({ width: 168, height: 168, data: new Uint8ClampedArray(168 * 168 * 4), colorSpace: 'srgb' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('scene workspace recovery', () => {
  it('keeps the current source usable when a demo fails to decode', async () => {
    vi.mocked(rasterizeUrlToImageData).mockRejectedValueOnce(new Error('Could not decode demo'))
    await act(async () => workspace.loadDemo({ ...demo, id: 'broken', name: 'Broken' }))
    const state = usePixelMeltStore.getState()
    expect(state.sourceLabel).toBe('First source')
    expect(state.sceneStatus).toBe('ready')
    expect(state.lastError).toBe('Could not decode demo')
    expect(controller.loadScene).toHaveBeenCalledTimes(1)
  })

  it('keeps metadata matched to the committed worker scene if a newer load fails during acknowledgement', async () => {
    let acknowledge!: (frame: FramePayload) => void
    vi.mocked(controller.loadScene).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve }))
    await act(async () => workspace.loadDemo({ ...demo, id: 'second', name: 'Second source' }))
    vi.mocked(rasterizeUrlToImageData).mockRejectedValueOnce(new Error('Third source failed'))
    await act(async () => workspace.loadDemo({ ...demo, id: 'third', name: 'Third source' }))
    const sent = vi.mocked(controller.loadScene).mock.calls.at(-1)![0]
    await act(async () => acknowledge({ snapshot: sent, metrics: summarizeSnapshot(sent) }))
    expect(usePixelMeltStore.getState().sourceLabel).toBe('Second source')
    expect(usePixelMeltStore.getState().selectedDemoId).toBe('second')
    expect(usePixelMeltStore.getState().sceneStatus).toBe('ready')
    expect(usePixelMeltStore.getState().lastError).toBe('Third source failed')
  })

  it('opens saved scenes paused with the exact tick and brush settings, then rebuilds the saved base', async () => {
    const saved: SavedScene = {
      snapshot: { ...createEmptySnapshot(168, 168, 52), tick: 289 },
      baseSnapshot: createEmptySnapshot(168, 168, 17),
      settings: { sourceLabel: 'Saved experiment', selectedDemoId: '', activePreset: 'burn', activeTool: 'erase', brushSize: 9, brushIntensity: .4 },
    }
    const file = { size: 230_000, text: async () => serializeSceneFile(saved) } as File
    await act(async () => workspace.openScene(file))
    expect(controller.loadScene).toHaveBeenLastCalledWith(saved.snapshot, true)
    expect(usePixelMeltStore.getState()).toMatchObject({ ...saved.settings, paused: true, sceneStatus: 'ready' })
    expect(usePixelMeltStore.getState().sceneNotice).toContain('tick 289')
    await act(async () => workspace.rebuild('melt'))
    expect(vi.mocked(controller.loadScene).mock.calls.at(-1)![0].tick).toBe(0)
    expect(usePixelMeltStore.getState().activePreset).toBe('melt')
  })

  it('leaves the current scene intact when opening corrupt scene files', async () => {
    await act(async () => workspace.openScene({ size: 10, text: async () => '{broken' } as File))
    expect(controller.loadScene).toHaveBeenCalledTimes(1)
    expect(usePixelMeltStore.getState()).toMatchObject({ sourceLabel: 'First source', sceneStatus: 'ready' })
    expect(usePixelMeltStore.getState().lastError).toContain('not valid scene JSON')
  })
})

import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { createLatestLoader } from '@/lib/latest-loader'
import { rasterizeFileToImageData, rasterizeUrlToImageData } from '@/lib/image-raster'
import { downloadBlob } from '@/lib/recorder'
import { readSceneFile, sceneFilename, serializeSceneFile, type SavedScene, type SceneSettings } from '@/lib/scene-file'
import { createSimulationController, type SimulationController } from '@/lib/simulation-controller'
import { convertImageDataToSnapshot } from '@/sim/image-to-material'
import { buildPresetScene } from '@/sim/presets'
import type { DemoScene, PresetId, SimulationSnapshot } from '@/sim/types'
import { usePixelMeltStore } from '@/store/use-pixelmelt-store'

interface PreparedScene extends SavedScene {
  paused: boolean
  restored: boolean
}

function settings(): SceneSettings {
  const state = usePixelMeltStore.getState()
  return {
    sourceLabel: state.sourceLabel,
    selectedDemoId: state.selectedDemoId,
    activePreset: state.activePreset,
    activeTool: state.activeTool,
    brushSize: state.brushSize,
    brushIntensity: state.brushIntensity,
  }
}

function prepareImage(imageData: ImageData, label: string, demoId: string): PreparedScene {
  const baseSnapshot = convertImageDataToSnapshot(imageData)
  const nextSettings = { ...settings(), sourceLabel: label, selectedDemoId: demoId }
  return {
    baseSnapshot,
    snapshot: buildPresetScene(baseSnapshot, nextSettings.activePreset),
    settings: nextSettings,
    paused: usePixelMeltStore.getState().paused,
    restored: false,
  }
}

function sourceLocked(): boolean {
  const state = usePixelMeltStore.getState()
  return state.savingScene || state.recording.status === 'recording' || state.recording.status === 'saving'
}

export function useSceneWorkspace(defaultDemo: DemoScene) {
  const controllerRef = useRef<SimulationController | null>(null)
  const baseRef = useRef<SimulationSnapshot | null>(null)
  const loaderRef = useRef<ReturnType<typeof createLatestLoader<PreparedScene>> | null>(null)
  const [controller, setController] = useState<SimulationController | null>(null)
  const paused = usePixelMeltStore((state) => state.paused)

  useEffect(() => {
    const nextController = createSimulationController()
    let engineFailed = false
    controllerRef.current = nextController
    startTransition(() => setController(nextController))
    const loader = createLatestLoader<PreparedScene>({
      onStart() {
        usePixelMeltStore.setState({ sceneStatus: 'loading', lastError: null, sceneNotice: null })
        nextController.setPaused(true)
      },
      onCommit(scene) {
        // Keep metadata with the state sent to the worker, even if another
        // preparation starts before this acknowledgement returns.
        baseRef.current = scene.baseSnapshot
        usePixelMeltStore.setState({ ...scene.settings, paused: scene.paused })
        return nextController.loadScene(scene.snapshot, scene.paused)
      },
      onReady(scene) {
        usePixelMeltStore.setState({
          sceneStatus: 'ready',
          sceneNotice: scene.restored ? `Scene restored at tick ${scene.snapshot.tick.toLocaleString()}. Press Play to continue.` : null,
          recording: { status: 'idle', remainingMs: 0, message: null },
        })
      },
      onError(error) {
        usePixelMeltStore.setState({
          sceneStatus: !engineFailed && baseRef.current ? 'ready' : 'error',
          lastError: error instanceof Error ? error.message : 'PixelMelt could not load this scene.',
        })
        nextController.setPaused(usePixelMeltStore.getState().paused)
      },
    })
    loaderRef.current = loader
    const unsubscribe = nextController.subscribeError((error) => {
      engineFailed = true
      loader.cancel()
      usePixelMeltStore.setState({ sceneStatus: 'error', lastError: error.message, savingScene: false, stepping: false })
    })
    void loader.run(async () => prepareImage(await rasterizeUrlToImageData(defaultDemo.src), defaultDemo.name, defaultDemo.id))
    return () => {
      loader.cancel()
      unsubscribe()
      nextController.destroy()
      controllerRef.current = null
      loaderRef.current = null
    }
  }, [defaultDemo])

  useEffect(() => {
    if (usePixelMeltStore.getState().sceneStatus === 'ready') controller?.setPaused(paused)
  }, [controller, paused])

  const loadDemo = useCallback((demo: DemoScene) => {
    if (sourceLocked()) return
    void loaderRef.current?.run(async () => prepareImage(await rasterizeUrlToImageData(demo.src), demo.name, demo.id))
  }, [])

  const uploadImage = useCallback((file: File) => {
    if (sourceLocked()) return
    const label = Array.from(file.name.replace(/\.[^.]+$/, '')).map((character) => character.charCodeAt(0) < 32 ? ' ' : character).join('').trim().slice(0, 120) || 'Untitled image'
    void loaderRef.current?.run(async () => prepareImage(await rasterizeFileToImageData(file), label, ''))
  }, [])

  const openScene = useCallback((file: File) => {
    if (sourceLocked()) return
    void loaderRef.current?.run(async () => ({ ...await readSceneFile(file), paused: true, restored: true }))
  }, [])

  const rebuild = useCallback((preset: PresetId) => {
    const baseSnapshot = baseRef.current
    if (!baseSnapshot || sourceLocked() || usePixelMeltStore.getState().sceneStatus !== 'ready') return
    void loaderRef.current?.run(async () => ({
      baseSnapshot,
      snapshot: buildPresetScene(baseSnapshot, preset),
      settings: { ...settings(), activePreset: preset },
      paused: usePixelMeltStore.getState().paused,
      restored: false,
    }))
  }, [])

  const saveScene = useCallback(async () => {
    const currentController = controllerRef.current
    const baseSnapshot = baseRef.current
    if (!currentController || !baseSnapshot || sourceLocked() || usePixelMeltStore.getState().sceneStatus !== 'ready') return
    const savedSettings = settings()
    usePixelMeltStore.setState({ savingScene: true, lastError: null, sceneNotice: null })
    try {
      // A correlated worker response includes every brush event queued before Save.
      const { snapshot } = await currentController.captureSnapshot()
      const text = serializeSceneFile({ snapshot, baseSnapshot, settings: savedSettings })
      downloadBlob(new Blob([text], { type: 'application/json' }), sceneFilename(savedSettings.sourceLabel))
      usePixelMeltStore.setState({ sceneNotice: `Scene file saved at tick ${snapshot.tick.toLocaleString()}. Use Open scene to restore it.` })
    } catch (error) {
      usePixelMeltStore.setState({ lastError: error instanceof Error ? error.message : 'The scene could not be saved.' })
    } finally {
      usePixelMeltStore.setState({ savingScene: false })
    }
  }, [])

  const step = useCallback(async () => {
    const state = usePixelMeltStore.getState()
    if (!controllerRef.current || !state.paused || state.sceneStatus !== 'ready' || state.stepping) return
    usePixelMeltStore.setState({ stepping: true })
    try {
      await controllerRef.current.stepBurst(1)
    } catch (error) {
      usePixelMeltStore.setState({ lastError: error instanceof Error ? error.message : 'The simulation could not advance.' })
    } finally {
      usePixelMeltStore.setState({ stepping: false })
    }
  }, [])

  return { controller, loadDemo, uploadImage, openScene, rebuild, saveScene, step }
}

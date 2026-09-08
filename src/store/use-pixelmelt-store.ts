import { create } from 'zustand'
import type { PresetId, ToolId } from '@/sim/types'

export type SceneStatus = 'booting' | 'loading' | 'ready' | 'error'
export type RecordingStatus = 'idle' | 'recording' | 'saving' | 'done' | 'unsupported' | 'error'

export interface RecordingState {
  status: RecordingStatus
  remainingMs: number
  message: string | null
}

interface PixelMeltState {
  activePreset: PresetId
  activeTool: ToolId
  brushSize: number
  brushIntensity: number
  paused: boolean
  sourceLabel: string
  selectedDemoId: string
  sceneStatus: SceneStatus
  lastError: string | null
  sceneNotice: string | null
  savingScene: boolean
  stepping: boolean
  recording: RecordingState
  setActivePreset: (preset: PresetId) => void
  setActiveTool: (tool: ToolId) => void
  setBrushSize: (size: number) => void
  setBrushIntensity: (intensity: number) => void
  setPaused: (paused: boolean) => void
  setSourceLabel: (label: string) => void
  setSelectedDemoId: (demoId: string) => void
  setSceneStatus: (status: SceneStatus) => void
  setLastError: (message: string | null) => void
  setRecording: (recording: RecordingState) => void
}

export const usePixelMeltStore = create<PixelMeltState>((set) => ({
  activePreset: 'melt',
  activeTool: 'push',
  brushSize: 6,
  brushIntensity: 0.72,
  paused: true,
  sourceLabel: 'Strata',
  selectedDemoId: 'strata',
  sceneStatus: 'booting',
  lastError: null,
  sceneNotice: null,
  savingScene: false,
  stepping: false,
  recording: {
    status: 'idle',
    remainingMs: 0,
    message: null,
  },
  setActivePreset: (activePreset) => set({ activePreset }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setBrushIntensity: (brushIntensity) => set({ brushIntensity }),
  setPaused: (paused) => set({ paused }),
  setSourceLabel: (sourceLabel) => set({ sourceLabel }),
  setSelectedDemoId: (selectedDemoId) => set({ selectedDemoId }),
  setSceneStatus: (sceneStatus) => set({ sceneStatus }),
  setLastError: (lastError) => set({ lastError }),
  setRecording: (recording) => set({ recording }),
}))

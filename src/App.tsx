import { useCallback, useEffect, useRef } from 'react'
import { CanvasStage, type CanvasStageHandle } from '@/components/CanvasStage'
import { ControlPanel } from '@/components/ControlPanel'
import { Icon } from '@/components/Icon'
import { useSceneWorkspace } from '@/lib/use-scene-workspace'
import { SIMULATION_FPS, type DemoScene } from '@/sim/types'
import { usePixelMeltStore } from '@/store/use-pixelmelt-store'

const DEMOS: DemoScene[] = [
  { id: 'astral-sigil', name: 'Astral Sigil', description: 'Glass and stone mask.', src: `${import.meta.env.BASE_URL}demo/astral-sigil.png` },
  { id: 'molten-echo', name: 'Molten Echo', description: 'Warm mask with ember seams.', src: `${import.meta.env.BASE_URL}demo/molten-echo.svg` },
  { id: 'tidal-idol', name: 'Tidal Idol', description: 'Stone and water sculpture.', src: `${import.meta.env.BASE_URL}demo/tidal-idol.svg` },
  { id: 'ember-bloom', name: 'Ember Bloom', description: 'Layered petals and embers.', src: `${import.meta.env.BASE_URL}demo/ember-bloom.svg` },
]

export default function App() {
  const stageRef = useRef<CanvasStageHandle>(null)
  const sceneInputRef = useRef<HTMLInputElement>(null)
  const state = usePixelMeltStore()
  const { controller, loadDemo, uploadImage, openScene, rebuild, saveScene, step } = useSceneWorkspace(DEMOS[0])
  const ready = state.sceneStatus === 'ready'
  const recordingBusy = state.recording.status === 'recording' || state.recording.status === 'saving'
  const sourceLocked = recordingBusy || state.savingScene
  const togglePause = useCallback(() => {
    const current = usePixelMeltStore.getState()
    if (current.sceneStatus === 'ready') current.setPaused(!current.paused)
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, [contenteditable="true"]')) return
      const current = usePixelMeltStore.getState()
      if (current.sceneStatus !== 'ready') return
      if (event.code === 'Space' && !target.closest('button, summary, a')) { event.preventDefault(); togglePause() }
      if (event.key === '1') current.setActiveTool('push')
      if (event.key === '2') current.setActiveTool('spark')
      if (event.key === '3') current.setActiveTool('erase')
      if (event.key === '[') current.setBrushSize(Math.max(2, current.brushSize - 1))
      if (event.key === ']') current.setBrushSize(Math.min(14, current.brushSize + 1))
      if (event.key === '.') void step()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [step, togglePause])

  useEffect(() => {
    if (!controller) return
    window.render_game_to_text = () => {
      const current = usePixelMeltStore.getState()
      return JSON.stringify({ source: current.sourceLabel, sceneStatus: current.sceneStatus, preset: current.activePreset, tool: current.activeTool, paused: current.paused, recording: current.recording.status, ...controller.getLatestPayload()?.metrics })
    }
    window.advanceTime = async (ms: number) => {
      const frames = Math.max(1, Math.round(ms / (1000 / SIMULATION_FPS)))
      const current = usePixelMeltStore.getState()
      if (current.sceneStatus !== 'ready') return
      controller.setPaused(true)
      try { await controller.stepBurst(frames) } finally { controller.setPaused(current.paused) }
    }
    return () => { delete window.render_game_to_text; delete window.advanceTime }
  }, [controller])

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="./" aria-label="PixelMelt home"><span className="brand-mark"><i /><i /><i /><i /></span><span>PixelMelt<span className="brand-description">Material playground</span></span></a>
        <div className="file-actions">
          <button type="button" className="button button-subtle" disabled={sourceLocked || state.sceneStatus === 'booting'} onClick={() => sceneInputRef.current?.click()}><Icon name="open" />Open scene</button>
          <button type="button" className="button button-outline" disabled={!ready || sourceLocked} onClick={() => void saveScene()}><Icon name="save" />{state.savingScene ? 'Saving…' : 'Save scene'}</button>
          <button type="button" className="button button-record" disabled={!ready || sourceLocked} onClick={() => void stageRef.current?.recordClip()}><Icon name="record" size={16} />{recordingBusy ? 'Recording…' : 'Record 8s clip'}</button>
        </div>
        <input ref={sceneInputRef} className="sr-only" tabIndex={-1} aria-label="Open saved scene" type="file" accept=".pixelmelt,.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) openScene(file); event.currentTarget.value = '' }} />
      </header>
      {(state.lastError || state.sceneNotice || state.recording.message) && <div className={`notice ${state.lastError || state.recording.status === 'error' || state.recording.status === 'unsupported' ? 'notice-error' : ''}`} role={state.lastError ? 'alert' : 'status'}>
        <span>{state.lastError ?? state.recording.message ?? state.sceneNotice}</span>
        {!recordingBusy && <button type="button" aria-label="Dismiss message" onClick={() => usePixelMeltStore.setState({ lastError: null, sceneNotice: null, recording: { status: 'idle', remainingMs: 0, message: null } })}><Icon name="close" size={16} /></button>}
      </div>}
      <main className="workspace">
        <CanvasStage ref={stageRef} controller={controller} activeTool={state.activeTool} activePreset={state.activePreset} brushSize={state.brushSize} brushIntensity={state.brushIntensity} sourceLabel={state.sourceLabel} paused={state.paused} sceneStatus={state.sceneStatus} stepping={state.stepping} sourceLocked={sourceLocked} onPauseToggle={togglePause} onStep={() => void step()} onReset={() => rebuild(state.activePreset)} />
        <ControlPanel demos={DEMOS} selectedDemoId={state.selectedDemoId} sceneStatus={state.sceneStatus} activePreset={state.activePreset} activeTool={state.activeTool} brushSize={state.brushSize} brushIntensity={state.brushIntensity} sourceLocked={sourceLocked} onSelectDemo={loadDemo} onUpload={uploadImage} onPresetChange={rebuild} onToolChange={state.setActiveTool} onBrushSizeChange={state.setBrushSize} onBrushIntensityChange={state.setBrushIntensity} />
      </main>
      <footer className="app-footer"><span>Image → materials → motion</span><span>Save a scene to keep experimenting. Record a clip to share it.</span></footer>
    </div>
  )
}

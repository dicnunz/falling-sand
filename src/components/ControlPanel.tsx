import { useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/cn'
import { MATERIAL_INFO, PRESET_OPTIONS, TOOL_OPTIONS } from '@/sim/materials'
import type { DemoScene, PresetId, ToolId } from '@/sim/types'
import type { SceneStatus } from '@/store/use-pixelmelt-store'

interface ControlPanelProps {
  demos: DemoScene[]
  selectedDemoId: string
  sceneStatus: SceneStatus
  activePreset: PresetId
  activeTool: ToolId
  brushSize: number
  brushIntensity: number
  sourceLocked: boolean
  onSelectDemo: (demo: DemoScene) => void
  onUpload: (file: File) => void
  onPresetChange: (preset: PresetId) => void
  onToolChange: (tool: ToolId) => void
  onBrushSizeChange: (size: number) => void
  onBrushIntensityChange: (intensity: number) => void
}

export function ControlPanel({ demos, selectedDemoId, sceneStatus, activePreset, activeTool, brushSize, brushIntensity, sourceLocked, onSelectDemo, onUpload, onPresetChange, onToolChange, onBrushSizeChange, onBrushIntensityChange }: ControlPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const ready = sceneStatus === 'ready'
  const sourceDisabled = sourceLocked || sceneStatus === 'booting'

  return (
    <aside className="control-panel" aria-label="Scene controls">
      <section className="control-section source-section">
        <div className="section-heading"><h2>Specimen</h2></div>
        <button
          type="button"
          className={cn('upload-target', isDragging && 'is-dragging')}
          disabled={sourceDisabled}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); if (!sourceDisabled) setIsDragging(true) }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false) }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            const file = event.dataTransfer.files?.[0]
            if (file && !sourceDisabled) onUpload(file)
          }}
        >
          <Icon name="upload" size={20} />
          <span><strong>Upload an image</strong><small>Drop or browse · 20 MB max</small></span>
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Upload source image" onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onUpload(file)
          event.currentTarget.value = ''
        }} />
        <div className="demo-heading">Samples</div>
        <div className="demo-grid">
          {demos.map((demo) => <button key={demo.id} type="button" className={cn('demo-button', selectedDemoId === demo.id && 'is-selected')} aria-pressed={selectedDemoId === demo.id} disabled={sourceDisabled} onClick={() => onSelectDemo(demo)}>
            <img src={demo.src} alt="" draggable={false} />
            <span>{demo.name}</span>
          </button>)}
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><h2>Conditions</h2></div>
        <div className="segmented-controls" aria-label="Scene preset">
          {PRESET_OPTIONS.map((item) => <button key={item.id} type="button" aria-pressed={item.id === activePreset} className={cn(item.id === activePreset && 'is-selected')} disabled={!ready || sourceLocked} onClick={() => onPresetChange(item.id)}>{item.label}</button>)}
        </div>
        <p className="muted-note">Rebuilds the original specimen.</p>
      </section>

      <section className="control-section brush-section">
        <div className="section-heading"><h2>Interaction</h2></div>
        <div className="tool-grid" aria-label="Brush tools">
          {TOOL_OPTIONS.map((item, index) => <button key={item.id} type="button" aria-pressed={item.id === activeTool} className={cn('tool-button', item.id === activeTool && 'is-selected')} onClick={() => onToolChange(item.id)} disabled={!ready} title={`${item.label} (${index + 1})`}>
            <kbd>{index + 1}</kbd><Icon name={item.id} size={22} /><span>{item.label}</span>
          </button>)}
        </div>
        <label className="range-control"><span>Brush radius <output>{brushSize} px</output></span><input aria-label="Brush radius" type="range" min={2} max={14} step={1} value={brushSize} disabled={!ready} onChange={(event) => onBrushSizeChange(Number(event.target.value))} /></label>
        <label className="range-control"><span>Force <output>{Math.round(brushIntensity * 100)}%</output></span><input aria-label="Brush force" type="range" min={0.35} max={1} step={0.01} value={brushIntensity} disabled={!ready} onChange={(event) => onBrushIntensityChange(Number(event.target.value))} /></label>
      </section>

      <details className="material-guide">
        <summary>Material key <Icon name="chevron" size={16} /></summary>
        <div>{Object.values(MATERIAL_INFO).map((material) => <p key={material.id}><span className="material-dot" style={{ background: material.swatch }} /><span><strong>{material.label}</strong><small>{material.hint}</small></span></p>)}</div>
      </details>
      <p className="local-note">Local session · save to keep</p>
    </aside>
  )
}

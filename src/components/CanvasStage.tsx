import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/Icon'
import { MATERIAL_INFO } from '@/sim/materials'
import { downloadBlob, recordCanvasClip, supportsCanvasRecording } from '@/lib/recorder'
import type { FramePayload, SimulationController } from '@/lib/simulation-controller'
import { rgbaForCell } from '@/sim/palette'
import { DISPLAY_SIZE, RECORDING_DURATION_MS, type PresetId, type ToolId } from '@/sim/types'
import { usePixelMeltStore } from '@/store/use-pixelmelt-store'

interface CanvasStageProps {
  controller: SimulationController | null
  activeTool: ToolId
  activePreset: PresetId
  brushSize: number
  brushIntensity: number
  sourceLabel: string
  paused: boolean
  sceneStatus: 'booting' | 'loading' | 'ready' | 'error'
  stepping: boolean
  sourceLocked: boolean
  onPauseToggle: () => void
  onStep: () => void
  onReset: () => void
}

export interface CanvasStageHandle {
  recordClip: () => Promise<void>
}

interface CursorState {
  visible: boolean
  x: number
  y: number
  diameter: number
}


function slugifyFilenamePart(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'untitled'
}

export const CanvasStage = forwardRef<CanvasStageHandle, CanvasStageProps>(function CanvasStage(
  { controller, activeTool, activePreset, brushSize, brushIntensity, sourceLabel, paused, sceneStatus, stepping, sourceLocked, onPauseToggle, onStep, onReset },
  ref,
) {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageDataRef = useRef<ImageData | null>(null)
  const latestGridWidthRef = useRef(168)
  const latestGridHeightRef = useRef(168)
  const latestPayloadRef = useRef<FramePayload | null>(null)
  const draggingRef = useRef(false)
  const lastGridPointRef = useRef<{ x: number; y: number } | null>(null)
  const [hudPayload, setHudPayload] = useState<FramePayload | null>(null)
  const [cursor, setCursor] = useState<CursorState>({ visible: false, x: 0, y: 0, diameter: 12 })
  const recording = usePixelMeltStore((state) => state.recording)
  const setRecording = usePixelMeltStore((state) => state.setRecording)

  function drawFrame(payload: FramePayload): void {
    const canvas = displayCanvasRef.current
    if (!canvas) {
      return
    }

    const { snapshot } = payload
    latestGridWidthRef.current = snapshot.width
    latestGridHeightRef.current = snapshot.height

    if (!bufferCanvasRef.current) {
      bufferCanvasRef.current = document.createElement('canvas')
    }

    const bufferCanvas = bufferCanvasRef.current
    if (bufferCanvas.width !== snapshot.width || bufferCanvas.height !== snapshot.height) {
      bufferCanvas.width = snapshot.width
      bufferCanvas.height = snapshot.height
      imageDataRef.current = null
    }

    const bufferContext = bufferCanvas.getContext('2d')
    const displayContext = canvas.getContext('2d')
    if (!bufferContext || !displayContext) {
      return
    }

    let imageData = imageDataRef.current
    if (!imageData || imageData.width !== snapshot.width || imageData.height !== snapshot.height) {
      imageData = bufferContext.createImageData(snapshot.width, snapshot.height)
      imageDataRef.current = imageData
    }

    const pixels = imageData.data
    for (let index = 0; index < snapshot.materials.length; index += 1) {
      const [red, green, blue, alpha] = rgbaForCell(snapshot.materials[index], snapshot.charge[index])
      const pixelOffset = index * 4
      pixels[pixelOffset] = red
      pixels[pixelOffset + 1] = green
      pixels[pixelOffset + 2] = blue
      pixels[pixelOffset + 3] = alpha
    }

    bufferContext.putImageData(imageData, 0, 0)
    displayContext.clearRect(0, 0, canvas.width, canvas.height)

    displayContext.fillStyle = '#080c12'
    displayContext.fillRect(0, 0, canvas.width, canvas.height)

    displayContext.save()
    displayContext.imageSmoothingEnabled = false
    displayContext.drawImage(bufferCanvas, 0, 0, canvas.width, canvas.height)
    displayContext.restore()

  }

  useEffect(() => {
    if (!controller) {
      return undefined
    }

    let lastHudUpdate = 0
    let hudTimer: ReturnType<typeof setTimeout> | null = null
    const updateHud = () => {
      hudTimer = null
      lastHudUpdate = performance.now()
      setHudPayload(latestPayloadRef.current)
    }
    const unsubscribe = controller.subscribeFrame((payload) => {
      latestPayloadRef.current = payload
      drawFrame(payload)
      if (performance.now() - lastHudUpdate >= 120) {
        if (hudTimer) clearTimeout(hudTimer)
        updateHud()
      } else if (!hudTimer) {
        hudTimer = setTimeout(updateHud, 120 - (performance.now() - lastHudUpdate))
      }
    })
    return () => {
      unsubscribe()
      if (hudTimer) clearTimeout(hudTimer)
    }
  }, [controller])

  function mapPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const relativeX = event.clientX - rect.left
    const relativeY = event.clientY - rect.top
    const gridX = Math.min(
      latestGridWidthRef.current - 1,
      Math.max(0, Math.floor((relativeX / rect.width) * latestGridWidthRef.current)),
    )
    const gridY = Math.min(
      latestGridHeightRef.current - 1,
      Math.max(0, Math.floor((relativeY / rect.height) * latestGridHeightRef.current)),
    )
    const diameter = (brushSize * 2 / latestGridWidthRef.current) * rect.width

    return {
      gridX,
      gridY,
      displayX: relativeX,
      displayY: relativeY,
      diameter,
    }
  }

  function applyPointerTool(nextX: number, nextY: number): void {
    if (!controller) {
      return
    }
    const lastPoint = lastGridPointRef.current
    const deltaX = lastPoint ? nextX - lastPoint.x : 0
    const deltaY = lastPoint ? nextY - lastPoint.y : 0
    controller.applyBrush({
      tool: activeTool,
      x: nextX,
      y: nextY,
      dx: deltaX,
      dy: deltaY,
      radius: brushSize,
      intensity: brushIntensity,
    })
    lastGridPointRef.current = { x: nextX, y: nextY }
  }

  async function recordClip(): Promise<void> {
    const canvas = displayCanvasRef.current
    const recordingStatus = usePixelMeltStore.getState().recording.status
    if (!canvas || sceneStatus !== 'ready' || !latestPayloadRef.current || recordingStatus === 'recording' || recordingStatus === 'saving') {
      return
    }

    if (!supportsCanvasRecording()) {
      setRecording({
        status: 'unsupported',
        remainingMs: 0,
        message: 'WebM export requires MediaRecorder support. Use current Chrome, Edge, or Firefox.',
      })
      return
    }

    try {
      setRecording({
        status: 'recording',
        remainingMs: RECORDING_DURATION_MS,
        message: 'Recording the visible canvas for eight seconds.',
      })

      const blob = await recordCanvasClip(canvas, (remainingMs) => {
        usePixelMeltStore.getState().setRecording({
          status: 'recording',
          remainingMs,
          message: 'Recording the visible canvas for eight seconds.',
        })
      })

      usePixelMeltStore.getState().setRecording({
        status: 'saving',
        remainingMs: 0,
        message: 'Encoding WebM clip…',
      })

      const timestamp = new Date().toISOString().replaceAll(':', '-')
      const sourceSlug = slugifyFilenamePart(sourceLabel)
      downloadBlob(blob, `pixelmelt-${sourceSlug}-${activePreset}-${timestamp}.webm`)

      usePixelMeltStore.getState().setRecording({
        status: 'done',
        remainingMs: 0,
        message: 'Clip exported. Share the downloaded WebM directly.',
      })

      window.setTimeout(() => {
        if (usePixelMeltStore.getState().recording.status !== 'done') return
        usePixelMeltStore.getState().setRecording({
          status: 'idle',
          remainingMs: 0,
          message: null,
        })
      }, 1_500)
    } catch (error) {
      usePixelMeltStore.getState().setRecording({
        status: 'error',
        remainingMs: 0,
        message: error instanceof Error ? error.message : 'PixelMelt could not export the clip.',
      })
    }
  }

  useImperativeHandle(ref, () => ({
    recordClip,
  }))

  const metrics = hudPayload?.metrics
  const ready = sceneStatus === 'ready'
  const counts = [metrics?.sandCells, metrics?.waterCells, metrics?.stoneCells, metrics?.emberCells, metrics?.smokeCells]

  return (
    <section className="canvas-stage" aria-label="Simulation workspace">
      <div className="stage-heading">
        <div className="scene-title"><h1>{sourceLabel}</h1><span>168 × 168 material field</span></div>
        <span className={cn('simulation-state', ready && !paused && 'is-running')}><span />{sceneStatus === 'loading' || sceneStatus === 'booting' ? 'Loading' : sceneStatus === 'error' ? 'Unavailable' : paused ? 'Paused' : 'Running'}</span>
      </div>
      <div className="canvas-surface">
        <div className="canvas-wrap">
          <canvas
            ref={displayCanvasRef}
            width={DISPLAY_SIZE}
            height={DISPLAY_SIZE}
            tabIndex={0}
            aria-label="Material simulation canvas"
            aria-describedby="canvas-help"
            onPointerDown={(event) => {
              if (!controller || !ready || event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              draggingRef.current = true
              const point = mapPointer(event)
              setCursor({ visible: true, x: point.displayX, y: point.displayY, diameter: point.diameter })
              lastGridPointRef.current = null
              applyPointerTool(point.gridX, point.gridY)
            }}
            onPointerMove={(event) => {
              const point = mapPointer(event)
              setCursor({ visible: true, x: point.displayX, y: point.displayY, diameter: point.diameter })
              if (draggingRef.current && ready) applyPointerTool(point.gridX, point.gridY)
            }}
            onPointerUp={(event) => {
              draggingRef.current = false
              lastGridPointRef.current = null
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              if (event.pointerType === 'touch') setCursor((current) => ({ ...current, visible: false }))
            }}
            onPointerLeave={() => {
              if (!draggingRef.current) setCursor((current) => ({ ...current, visible: false }))
            }}
            onPointerCancel={() => {
              draggingRef.current = false
              lastGridPointRef.current = null
              setCursor((current) => ({ ...current, visible: false }))
            }}
          />
          {cursor.visible && ready && <div className={cn('brush-cursor', `brush-${activeTool}`)} style={{ width: Math.max(10, cursor.diameter), height: Math.max(10, cursor.diameter), left: cursor.x, top: cursor.y }} />}
          {(sceneStatus === 'loading' || sceneStatus === 'booting') && <div className="canvas-overlay"><span className="loading-indicator" /><span>Preparing material field…</span></div>}
          {sceneStatus === 'error' && <div className="canvas-overlay"><strong>Could not load the scene</strong><span>Choose another image or open a saved scene.</span></div>}
          {recording.status === 'recording' && <span className="recording-indicator"><span />Recording · {(recording.remainingMs / 1000).toFixed(1)}s</span>}
        </div>
      </div>
      <div className="playback-bar">
        <div className="playback-buttons">
          <button className="button button-play" type="button" onClick={onPauseToggle} disabled={!ready} title="Play / pause (Space)"><Icon name={paused ? 'play' : 'pause'} size={16} />{paused ? 'Play' : 'Pause'}</button>
          <button className="button button-subtle" type="button" onClick={onStep} disabled={!ready || !paused || stepping} title="Advance one simulation tick (.)"><Icon name="step" size={16} />Step</button>
          <button className="button button-subtle" type="button" onClick={onReset} disabled={!ready || sourceLocked} title="Rebuild the current preset from the original source"><Icon name="reset" size={16} />Reset</button>
        </div>
        <span className="tick-counter">Tick <output data-testid="tick-count">{metrics?.tick.toLocaleString() ?? '—'}</output></span>
      </div>
      <div className="material-meter" aria-label="Material cell counts">
        {Object.values(MATERIAL_INFO).map((material, index) => <span key={material.id} title={material.hint}><i style={{ background: material.swatch }} />{material.label}<strong>{counts[index]?.toLocaleString() ?? '—'}</strong></span>)}
      </div>
      <div className="canvas-help" id="canvas-help"><span>{activeTool === 'push' ? 'Drag across the canvas to push materials.' : activeTool === 'spark' ? 'Click or drag to add embers.' : 'Brush across the canvas to erase materials.'}</span><span className="keyboard-hint"><kbd>Space</kbd> play / pause</span></div>
    </section>
  )
})

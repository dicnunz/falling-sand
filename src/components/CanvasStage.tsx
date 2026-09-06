import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cn } from '@/lib/cn'
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


function formatCompactCount(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatUiLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
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
  { controller, activeTool, activePreset, brushSize, brushIntensity, sourceLabel, paused, sceneStatus },
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

    const background = displayContext.createLinearGradient(0, 0, canvas.width, canvas.height)
    background.addColorStop(0, '#040812')
    background.addColorStop(0.55, '#09111d')
    background.addColorStop(1, '#02050b')
    displayContext.fillStyle = background
    displayContext.fillRect(0, 0, canvas.width, canvas.height)

    displayContext.save()
    displayContext.imageSmoothingEnabled = false
    displayContext.drawImage(bufferCanvas, 0, 0, canvas.width, canvas.height)
    displayContext.restore()

    displayContext.fillStyle = 'rgba(255, 255, 255, 0.015)'
    for (let y = 0; y < canvas.height; y += 8) {
      displayContext.fillRect(0, y, canvas.width, 1)
    }

    const vignette = displayContext.createRadialGradient(
      canvas.width * 0.5,
      canvas.height * 0.4,
      canvas.width * 0.08,
      canvas.width * 0.5,
      canvas.height * 0.5,
      canvas.width * 0.75,
    )
    vignette.addColorStop(0, 'rgba(255, 255, 255, 0)')
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
    displayContext.fillStyle = vignette
    displayContext.fillRect(0, 0, canvas.width, canvas.height)
  }

  useEffect(() => {
    if (!controller) {
      return undefined
    }

    let lastHudUpdate = 0
    return controller.subscribeFrame((payload) => {
      latestPayloadRef.current = payload
      drawFrame(payload)
      const now = performance.now()
      if (now - lastHudUpdate > 120) {
        lastHudUpdate = now
        setHudPayload(payload)
      }
    })
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
    if (!canvas || sceneStatus !== 'ready' || !latestPayloadRef.current) {
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
  const hasFrame = Boolean(hudPayload)
  const exportDisabled = sceneStatus !== 'ready' || !hasFrame || recording.status === 'recording' || recording.status === 'saving'

  return (
    <section className="pm-panel relative flex min-h-[calc(100vh-3rem)] flex-1 flex-col overflow-hidden rounded-[32px]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,226,196,0.08),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,148,71,0.08),transparent_30%)]" />
      <div className="relative flex items-center justify-between gap-4 border-b border-white/8 px-6 py-4">
        <div>
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.24em] text-white/45">Stage</div>
          <div className="mt-1 text-lg font-semibold text-white">{sourceLabel}</div>
          <div className="text-sm text-[var(--pm-text-muted)]">
            {formatUiLabel(activePreset)} scene • {formatUiLabel(activeTool)} brush • {paused ? 'paused' : 'live worker sim'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => void recordClip()}
            disabled={exportDisabled}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-semibold transition',
              exportDisabled
                ? 'cursor-not-allowed border-white/10 bg-white/[0.03] text-white/45'
                : 'border-[var(--pm-warm)] bg-[rgba(255,148,71,0.12)] text-white hover:bg-[rgba(255,148,71,0.2)]',
            )}
          >
            Export 8s WebM
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-6 py-6">
        {sceneStatus === 'ready' && (
          <div className="pointer-events-none absolute left-6 top-6 hidden max-w-sm xl:block">
            <div className="rounded-[24px] border border-white/8 bg-[rgba(7,11,19,0.72)] px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.22)] backdrop-blur">
              <div className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-white/40">Quick pass</div>
              <p className="mt-2 text-sm leading-6 text-white/85">
                Pick a bold source, rebuild with a preset, then drag with Push or click with Spark before exporting the exact frame state you like.
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--pm-text-muted)]">
                Best with faces, masks, flowers, logos, and silhouettes that have clear contrast and some empty space around them.
              </p>
            </div>
          </div>
        )}

        <div className="relative flex aspect-square w-full max-w-[880px] items-center justify-center rounded-[30px] border border-white/10 bg-[rgba(2,5,11,0.72)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <canvas
            ref={displayCanvasRef}
            width={DISPLAY_SIZE}
            height={DISPLAY_SIZE}
            onPointerDown={(event) => {
              if (!controller || sceneStatus !== 'ready') {
                return
              }
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
              if (!draggingRef.current || sceneStatus !== 'ready') {
                return
              }
              applyPointerTool(point.gridX, point.gridY)
            }}
            onPointerUp={(event) => {
              draggingRef.current = false
              lastGridPointRef.current = null
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerLeave={() => {
              if (!draggingRef.current) {
                setCursor((current) => ({ ...current, visible: false }))
              }
            }}
            onPointerCancel={() => {
              draggingRef.current = false
              lastGridPointRef.current = null
            }}
            className="aspect-square h-full w-full rounded-[24px] border border-white/8 bg-black/30 shadow-[0_30px_60px_rgba(0,0,0,0.45)] [touch-action:none]"
          />

          <div className="pointer-events-none absolute inset-0">
            {cursor.visible && sceneStatus === 'ready' && (
              <div
                className={cn(
                  'absolute rounded-full border transition',
                  activeTool === 'spark'
                    ? 'border-orange-300/80 bg-orange-400/10'
                    : activeTool === 'erase'
                      ? 'border-white/70 bg-white/5'
                      : 'border-[var(--pm-accent)] bg-[rgba(109,226,196,0.08)]',
                )}
                style={{
                  width: `${Math.max(10, cursor.diameter)}px`,
                  height: `${Math.max(10, cursor.diameter)}px`,
                  left: `${cursor.x}px`,
                  top: `${cursor.y}px`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )}
          </div>

          {!hasFrame && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[24px] bg-[rgba(2,5,11,0.55)]">
              <div className="max-w-sm text-center">
                <div className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-white/50">Booting</div>
                <p className="text-lg font-semibold text-white">
                  Spinning up the worker-driven material sim.
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--pm-text-muted)]">
                  The default demo loads automatically, then you can swap demos or upload your own image.
                </p>
              </div>
            </div>
          )}

          {sceneStatus === 'loading' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[24px] bg-[rgba(2,5,11,0.45)]">
              <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white">
                Rebuilding material map…
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative grid gap-3 border-t border-white/8 px-6 py-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-white/40">Active cells</div>
          <div className="mt-1 text-xl font-semibold text-white">{metrics ? formatCompactCount(metrics.activeCells) : '—'}</div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-white/40">Water / Ember</div>
          <div className="mt-1 text-xl font-semibold text-white">
            {metrics ? `${formatCompactCount(metrics.waterCells)} / ${formatCompactCount(metrics.emberCells)}` : '—'}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-white/40">Smoke / Stone</div>
          <div className="mt-1 text-xl font-semibold text-white">
            {metrics ? `${formatCompactCount(metrics.smokeCells)} / ${formatCompactCount(metrics.stoneCells)}` : '—'}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-white/40">Status</div>
          <div className="mt-1 text-xl font-semibold text-white">
            {recording.status === 'recording'
              ? `${(recording.remainingMs / 1000).toFixed(1)}s left`
              : paused
                ? 'Paused'
                : hasFrame
                  ? `Tick ${metrics?.tick ?? 0}`
                  : 'Loading'}
          </div>
        </div>
      </div>
    </section>
  )
})

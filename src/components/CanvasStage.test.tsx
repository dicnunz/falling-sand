// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { CanvasStage } from './CanvasStage'
import type { SimulationController } from '@/lib/simulation-controller'

test('a second pointer cannot alter or end a stroke; lost capture ends it', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const applyBrush = vi.fn()
  const controller = { applyBrush, subscribeFrame: () => () => {} } as unknown as SimulationController
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<CanvasStage controller={controller} activeTool="push" activePreset="melt" brushSize={4} brushIntensity={1} sourceLabel="Test" paused={false} sceneStatus="ready" stepping={false} sourceLocked={false} onPauseToggle={() => {}} onStep={() => {}} onReset={() => {}} />))
  const canvas = host.querySelector('canvas')!
  canvas.setPointerCapture = vi.fn()
  canvas.hasPointerCapture = () => true
  canvas.releasePointerCapture = vi.fn()
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 168, height: 168 }) as DOMRect
  const send = async (type: string, id: number, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 20, button: 0 })
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } })
    await act(async () => canvas.dispatchEvent(event))
  }
  await send('pointerdown', 1, 10)
  await send('pointerdown', 2, 80)
  await send('pointermove', 2, 90)
  await send('pointerup', 2, 90)
  // A second touch still receives implicit pointer capture in a real browser.
  await send('lostpointercapture', 2, 90)
  expect(applyBrush).toHaveBeenCalledTimes(1)
  await send('pointermove', 1, 20)
  expect(applyBrush).toHaveBeenLastCalledWith(expect.objectContaining({ x: 20, dx: 10 }))
  await send('lostpointercapture', 1, 20)
  await send('pointermove', 1, 30)
  expect(applyBrush).toHaveBeenCalledTimes(2)
  await act(async () => root.unmount())
  host.remove()
})

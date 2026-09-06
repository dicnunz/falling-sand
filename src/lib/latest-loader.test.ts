import { describe, expect, it, vi } from 'vitest'
import { createLatestLoader } from '@/lib/latest-loader'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup() {
  const callbacks = { onStart: vi.fn(), onCommit: vi.fn(async () => {}), onReady: vi.fn(), onError: vi.fn() }
  return { ...callbacks, loader: createLatestLoader<string>(callbacks) }
}

describe('scene load ordering', () => {
  it('starts loading immediately and ignores a slow default demo after a newer upload succeeds', async () => {
    const first = deferred<string>()
    const test = setup()
    const slowLoad = test.loader.run(() => first.promise)
    expect(test.onStart).toHaveBeenCalledOnce()
    await test.loader.run(async () => 'new upload')
    first.resolve('old demo')
    await slowLoad
    expect(test.onCommit.mock.calls).toEqual([['new upload']])
    expect(test.onReady.mock.calls).toEqual([['new upload']])
    expect(test.onError).not.toHaveBeenCalled()
  })

  it('does not show errors from an obsolete demo request', async () => {
    const first = deferred<string>()
    const test = setup()
    const slowLoad = test.loader.run(() => first.promise)
    await test.loader.run(async () => 'new demo')
    first.reject(new Error('network error from old demo'))
    await slowLoad
    expect(test.onError).not.toHaveBeenCalled()
  })

  it('catches decode errors before commit so the previous scene can remain intact', async () => {
    const test = setup()
    const error = new Error('invalid image')
    await test.loader.run(async () => { throw error })
    expect(test.onCommit).not.toHaveBeenCalled()
    expect(test.onReady).not.toHaveBeenCalled()
    expect(test.onError).toHaveBeenCalledWith(error)
  })

  it('waits for the worker acknowledgement, ignoring superseded acknowledgements', async () => {
    const acknowledgement = deferred<void>()
    const test = setup()
    test.onCommit.mockImplementationOnce(() => acknowledgement.promise)
    const oldLoad = test.loader.run(async () => 'old scene')
    await Promise.resolve()
    expect(test.onReady).not.toHaveBeenCalled()
    await test.loader.run(async () => 'new scene')
    acknowledgement.resolve()
    await oldLoad
    expect(test.onReady.mock.calls).toEqual([['new scene']])
  })

  it('cancels unfinished loads when the workspace unmounts', async () => {
    const preparation = deferred<string>()
    const test = setup()
    const load = test.loader.run(() => preparation.promise)
    test.loader.cancel()
    preparation.resolve('abandoned')
    await load
    expect(test.onCommit).not.toHaveBeenCalled()
    expect(test.onReady).not.toHaveBeenCalled()
  })
})

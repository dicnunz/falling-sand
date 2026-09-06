interface LoaderCallbacks<T> {
  onStart: () => void
  onCommit: (value: T) => Promise<unknown>
  onReady: (value: T) => void
  onError: (error: unknown) => void
}

/** Only the newest request may commit a result or report success/failure. */
export function createLatestLoader<T>(callbacks: LoaderCallbacks<T>) {
  let generation = 0
  return {
    async run(prepare: () => Promise<T>): Promise<void> {
      const request = ++generation
      callbacks.onStart()
      try {
        const value = await prepare()
        if (request !== generation) return
        await callbacks.onCommit(value)
        if (request === generation) callbacks.onReady(value)
      } catch (error) {
        if (request === generation) callbacks.onError(error)
      }
    },
    cancel() {
      generation += 1
    },
  }
}

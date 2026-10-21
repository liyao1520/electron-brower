import type { Unsubscribe } from '../types'

function disposeAll(cleanups: Unsubscribe[]): void {
  const errors: unknown[] = []
  // 先清空集合，再逆序释放；清理失败也继续处理其他注册。
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Failed to clean up IPC router')
}

export function registerWithCleanup(setup: (cleanups: Unsubscribe[]) => void): Unsubscribe {
  const cleanups: Unsubscribe[] = []
  const dispose = (): void => disposeAll(cleanups)
  try {
    setup(cleanups)
  } catch (error) {
    try {
      dispose()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'IPC router registration and rollback failed',
        {
          cause: cleanupError
        }
      )
    }
    throw error
  }
  return dispose
}

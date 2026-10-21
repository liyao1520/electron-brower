import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

export type IpcMiddlewareCall<Context extends object> = {
  readonly ctx: Readonly<Context>
  readonly channel: string
  readonly args: readonly unknown[]
} & (
  | { readonly kind: 'invoke'; readonly event: IpcMainInvokeEvent }
  | { readonly kind: 'event'; readonly event: IpcMainEvent }
)

export type IpcMiddleware<Context extends object> = <Result>(
  call: IpcMiddlewareCall<Context>,
  next: () => Promise<Result>
) => Promise<Result>

export type IpcEventErrorHandler<Context extends object> = (
  error: unknown,
  call: Extract<IpcMiddlewareCall<Context>, { kind: 'event' }>
) => void | Promise<void>

// 调用方在注册时固定中间件列表；每次调用只创建独立的执行位置。
export async function runMiddlewares<Context extends object, Result>(
  middlewares: readonly IpcMiddleware<Context>[],
  call: IpcMiddlewareCall<Context>,
  handler: () => Result | Promise<Result>
): Promise<Result> {
  let lastIndex = -1

  async function dispatch(index: number): Promise<Result> {
    if (index <= lastIndex) throw new Error('next() called multiple times')
    lastIndex = index

    if (index === middlewares.length) return handler()
    const middleware = middlewares[index]
    return middleware(call, () => dispatch(index + 1))
  }

  return dispatch(0)
}

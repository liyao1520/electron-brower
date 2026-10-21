import type { EmptyEvents, IpcEvents, IpcHandlers, IpcNamespace } from '../types'
import { IpcRouter } from './ipc-router'
import type { IpcEventErrorHandler, IpcMiddleware } from './middleware'

export type CreateIpcRouter<
  Requests extends IpcHandlers,
  Context extends object,
  RendererToMain extends IpcEvents = EmptyEvents
> = <Namespace extends IpcNamespace<Requests> | IpcNamespace<RendererToMain>>(
  namespace: Namespace
) => IpcRouter<Requests, Namespace, Context, RendererToMain>

export function initIpcRouter<
  Requests extends IpcHandlers,
  Context extends object,
  RendererToMain extends IpcEvents = EmptyEvents
>({
  context,
  middlewares = [],
  onError
}: {
  context: Context
  middlewares?: readonly IpcMiddleware<Context>[]
  onError?: IpcEventErrorHandler<Context>
}): CreateIpcRouter<Requests, Context, RendererToMain> {
  const globalMiddlewares = [...middlewares]
  return (namespace) => new IpcRouter(namespace, context, globalMiddlewares, onError)
}

import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'
import type { EmptyEvents, IpcEvents, IpcHandlers, ModuleChannel, Unsubscribe } from '../types'
import { registerWithCleanup } from './lifecycle'
import { runMiddlewares } from './middleware'
import type { IpcEventErrorHandler, IpcMiddleware, IpcMiddlewareCall } from './middleware'
import { TypedIpcMain } from './typed-ipc-main'
import type { EventListener, InvokeListener } from './typed-ipc-main'

export interface IpcCallContext<Context extends object, Event = IpcMainInvokeEvent> {
  readonly event: Event
  readonly ctx: Readonly<Context>
}

export type RouterInvokeListener<
  F extends (...args: never[]) => unknown,
  Context extends object
> = (
  call: IpcCallContext<Context>,
  ...args: Parameters<F>
) => Awaited<ReturnType<F>> | Promise<Awaited<ReturnType<F>>>

export type RouterEventListener<F extends (...args: never[]) => void, Context extends object> = (
  call: IpcCallContext<Context, IpcMainEvent>,
  ...args: Parameters<F>
) => void

export class IpcRouter<
  Requests extends IpcHandlers,
  Namespace extends string,
  Context extends object,
  Events extends IpcEvents = EmptyEvents
> {
  private readonly ipc = new TypedIpcMain<Requests, Events>()
  private readonly registrations: Array<(ipc: TypedIpcMain<Requests, Events>) => Unsubscribe> = []
  private readonly requests = new Set<string>()
  private readonly middlewares: IpcMiddleware<Context>[]
  private mounted = false

  public constructor(
    public readonly namespace: Namespace,
    private readonly context: Readonly<Context>,
    globalMiddlewares: readonly IpcMiddleware<Context>[] = [],
    private readonly onError?: IpcEventErrorHandler<Context>
  ) {
    if (!namespace || namespace.includes(':')) throw new Error('Invalid IPC namespace')
    this.middlewares = [...globalMiddlewares]
  }

  public use(...middlewares: IpcMiddleware<Context>[]): this {
    if (this.mounted) throw new Error('Cannot modify a registered IPC router')
    this.middlewares.push(...middlewares)
    return this
  }

  public handle<C extends ModuleChannel<Requests, Namespace>>(
    channel: C,
    listener: RouterInvokeListener<Requests[C], Context>
  ): this {
    this.addRequest(channel)
    this.registrations.push((ipc) => ipc.handle(channel, this.wrapInvoke(channel, listener)))
    return this
  }

  public handleOnce<C extends ModuleChannel<Requests, Namespace>>(
    channel: C,
    listener: RouterInvokeListener<Requests[C], Context>
  ): this {
    this.addRequest(channel)
    this.registrations.push((ipc) => ipc.handleOnce(channel, this.wrapInvoke(channel, listener)))
    return this
  }

  public on<C extends ModuleChannel<Events, Namespace>>(
    channel: C,
    listener: RouterEventListener<Events[C], Context>
  ): this {
    this.assertMutable(channel)
    this.registrations.push((ipc) => ipc.on(channel, this.wrapEvent(channel, listener)))
    return this
  }

  public once<C extends ModuleChannel<Events, Namespace>>(
    channel: C,
    listener: RouterEventListener<Events[C], Context>
  ): this {
    this.assertMutable(channel)
    this.registrations.push((ipc) => ipc.once(channel, this.wrapEvent(channel, listener)))
    return this
  }

  public register(): Unsubscribe {
    if (this.mounted) throw new Error('IPC router is already registered')
    this.mounted = true
    return registerWithCleanup((cleanups) => {
      cleanups.push(() => {
        this.mounted = false
      })
      for (const register of this.registrations) cleanups.push(register(this.ipc))
    })
  }

  private wrapInvoke<C extends ModuleChannel<Requests, Namespace>>(
    channel: C,
    listener: RouterInvokeListener<Requests[C], Context>
  ): InvokeListener<Requests[C]> {
    const middlewares = [...this.middlewares]
    return (event, ...args) => {
      const call: IpcMiddlewareCall<Context> = {
        kind: 'invoke',
        event,
        ctx: this.context,
        channel,
        args
      }
      return runMiddlewares<Context, Awaited<ReturnType<Requests[C]>>>(middlewares, call, () =>
        listener(call, ...args)
      )
    }
  }

  private wrapEvent<C extends ModuleChannel<Events, Namespace>>(
    channel: C,
    listener: RouterEventListener<Events[C], Context>
  ): EventListener<Events[C]> {
    const middlewares = [...this.middlewares]
    return (event, ...args) => {
      const call: Extract<IpcMiddlewareCall<Context>, { kind: 'event' }> = {
        kind: 'event',
        event,
        ctx: this.context,
        channel,
        args
      }
      void runMiddlewares<Context, void>(middlewares, call, () => listener(call, ...args)).catch(
        (error: unknown) => this.reportEventError(error, call)
      )
    }
  }

  private async reportEventError(
    error: unknown,
    call: Extract<IpcMiddlewareCall<Context>, { kind: 'event' }>
  ): Promise<void> {
    try {
      if (this.onError) await this.onError(error, call)
      else console.error(`[typed-ipc] Event "${call.channel}" failed`, error)
    } catch (reportingError) {
      console.error(`[typed-ipc] onError failed for "${call.channel}"`, reportingError, error)
    }
  }

  private assertMutable(channel: string): void {
    if (this.mounted) throw new Error('Cannot modify a registered IPC router')
    if (!channel.startsWith(`${this.namespace}:`) || channel.length === this.namespace.length + 1) {
      throw new Error(`IPC channel "${channel}" does not belong to namespace "${this.namespace}"`)
    }
  }

  private addRequest(channel: string): void {
    this.assertMutable(channel)
    if (this.requests.has(channel)) throw new Error(`IPC handler already defined: ${channel}`)
    this.requests.add(channel)
  }
}

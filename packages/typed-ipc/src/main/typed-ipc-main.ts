import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent, IpcMainEvent, WebContents } from 'electron'
import { IpcSubscriptions } from '../subscriptions'
import type { IpcEvents, IpcHandlers, Unsubscribe } from '../types'

export type InvokeListener<F extends (...args: never[]) => unknown> = (
  event: IpcMainInvokeEvent,
  ...args: Parameters<F>
) => Awaited<ReturnType<F>> | Promise<Awaited<ReturnType<F>>>

export type EventListener<F extends (...args: never[]) => void> = (
  event: IpcMainEvent,
  ...args: Parameters<F>
) => void

// ipcMain 的请求处理函数在进程内共享，所有封装实例共用注册归属。
const handlerOwners = new Map<string, symbol>()

export class TypedIpcMain<
  T extends IpcHandlers,
  RendererToMain extends IpcEvents = Record<never, never>,
  MainToRenderer extends IpcEvents = Record<never, never>
> {
  // 仅用于类型检查，保证不同实例的协议兼容；不生成运行时字段。
  declare protected readonly protocol: {
    requests: T
    rendererToMain: RendererToMain
    mainToRenderer: MainToRenderer
  }

  private readonly subscriptions = new IpcSubscriptions()

  public handle<C extends keyof T & string>(
    channel: C,
    listener: InvokeListener<T[C]>
  ): Unsubscribe {
    return this.registerHandler(channel, listener, false)
  }

  public handleOnce<C extends keyof T & string>(
    channel: C,
    listener: InvokeListener<T[C]>
  ): Unsubscribe {
    return this.registerHandler(channel, listener, true)
  }

  public removeHandler<C extends keyof T & string>(channel: C): void {
    ipcMain.removeHandler(channel)
    handlerOwners.delete(channel)
  }

  public on<C extends keyof RendererToMain & string>(
    channel: C,
    listener: EventListener<RendererToMain[C]>
  ): Unsubscribe {
    return this.subscribe(channel, listener, false)
  }

  public once<C extends keyof RendererToMain & string>(
    channel: C,
    listener: EventListener<RendererToMain[C]>
  ): Unsubscribe {
    return this.subscribe(channel, listener, true)
  }

  public off<C extends keyof RendererToMain & string>(
    channel: C,
    listener: EventListener<RendererToMain[C]>
  ): void {
    this.subscriptions.off(channel, listener)
  }

  public send<C extends keyof MainToRenderer & string>(
    target: WebContents,
    channel: C,
    ...args: Parameters<MainToRenderer[C]>
  ): void {
    target.send(channel, ...args)
  }

  private registerHandler<C extends keyof T & string>(
    channel: C,
    listener: InvokeListener<T[C]>,
    once: boolean
  ): Unsubscribe {
    const owner = Symbol(channel)

    if (once) {
      ipcMain.handleOnce(channel, (event, ...args: Parameters<T[C]>) => {
        if (handlerOwners.get(channel) === owner) handlerOwners.delete(channel)
        return listener(event, ...args)
      })
    } else {
      ipcMain.handle(channel, listener)
    }
    handlerOwners.set(channel, owner)

    return () => {
      if (handlerOwners.get(channel) !== owner) return
      ipcMain.removeHandler(channel)
      handlerOwners.delete(channel)
    }
  }

  private subscribe<C extends keyof RendererToMain & string>(
    channel: C,
    listener: EventListener<RendererToMain[C]>,
    once: boolean
  ): Unsubscribe {
    const wrapped: EventListener<RendererToMain[C]> = (event, ...args) => {
      if (once) unsubscribe()
      listener(event, ...args)
    }

    if (once) ipcMain.once(channel, wrapped)
    else ipcMain.on(channel, wrapped)

    const unsubscribe = this.subscriptions.add(channel, listener, () => {
      ipcMain.off(channel, wrapped)
    })
    return unsubscribe
  }
}

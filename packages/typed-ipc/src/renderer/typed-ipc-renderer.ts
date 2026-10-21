import { ipcRenderer } from 'electron'
import { IpcSubscriptions } from '../subscriptions'
import type { IpcEvents, IpcHandlers, Unsubscribe } from '../types'

type EventListener<F extends (...args: never[]) => void> = (...args: Parameters<F>) => void

export class TypedIpcRenderer<
  T extends IpcHandlers,
  RendererToMain extends IpcEvents = Record<never, never>,
  MainToRenderer extends IpcEvents = Record<never, never>
> {
  private readonly subscriptions = new IpcSubscriptions()

  public invoke<C extends keyof T & string>(
    channel: C,
    ...args: Parameters<T[C]>
  ): Promise<Awaited<ReturnType<T[C]>>> {
    return ipcRenderer.invoke(channel, ...args)
  }

  public send<C extends keyof RendererToMain & string>(
    channel: C,
    ...args: Parameters<RendererToMain[C]>
  ): void {
    ipcRenderer.send(channel, ...args)
  }

  public on<C extends keyof MainToRenderer & string>(
    channel: C,
    listener: EventListener<MainToRenderer[C]>
  ): Unsubscribe {
    return this.subscribe(channel, listener, false)
  }

  public once<C extends keyof MainToRenderer & string>(
    channel: C,
    listener: EventListener<MainToRenderer[C]>
  ): Unsubscribe {
    return this.subscribe(channel, listener, true)
  }

  public off<C extends keyof MainToRenderer & string>(
    channel: C,
    listener: EventListener<MainToRenderer[C]>
  ): void {
    this.subscriptions.off(channel, listener)
  }

  private subscribe<C extends keyof MainToRenderer & string>(
    channel: C,
    listener: EventListener<MainToRenderer[C]>,
    once: boolean
  ): Unsubscribe {
    // 页面回调只接收业务参数，不暴露 Electron event。
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      ...args: Parameters<MainToRenderer[C]>
    ): void => {
      if (once) unsubscribe()
      listener(...args)
    }

    if (once) ipcRenderer.once(channel, wrapped)
    else ipcRenderer.on(channel, wrapped)

    const unsubscribe = this.subscriptions.add(channel, listener, () => {
      ipcRenderer.off(channel, wrapped)
    })
    return unsubscribe
  }
}

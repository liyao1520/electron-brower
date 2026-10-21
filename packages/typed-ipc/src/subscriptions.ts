import type { Unsubscribe } from './types'

export class IpcSubscriptions {
  // 仅用回调的对象引用关联订阅，不在这里执行回调。
  private readonly channels = new Map<string, Map<object, Unsubscribe[]>>()

  public add(channel: string, listener: object, remove: Unsubscribe): Unsubscribe {
    let listeners = this.channels.get(channel)
    if (!listeners) {
      listeners = new Map()
      this.channels.set(channel, listeners)
    }

    let subscriptions = listeners.get(listener)
    if (!subscriptions) {
      subscriptions = []
      listeners.set(listener, subscriptions)
    }

    let active = true
    const unsubscribe = (): void => {
      if (!active) return
      active = false
      remove()

      subscriptions.splice(subscriptions.indexOf(unsubscribe), 1)
      if (subscriptions.length === 0) listeners.delete(listener)
      if (listeners.size === 0) this.channels.delete(channel)
    }

    subscriptions.push(unsubscribe)
    return unsubscribe
  }

  // 与 EventEmitter.off 一致：只取消最近一次匹配的订阅。
  public off(channel: string, listener: object): void {
    this.channels.get(channel)?.get(listener)?.at(-1)?.()
  }
}

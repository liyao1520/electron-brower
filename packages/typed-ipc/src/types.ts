export type IpcHandlers = Record<string, (...args: never[]) => unknown>
export type IpcEvents = Record<string, (...args: never[]) => void>
export type EmptyEvents = Record<never, never>
export type Unsubscribe = () => void

export type ModuleChannel<T, Namespace extends string> = Extract<keyof T, `${Namespace}:${string}`>

type ChannelNamespace<Channel> = Channel extends `${infer Namespace}:${string}` ? Namespace : never
export type IpcNamespace<T> = ChannelNamespace<keyof T & string>

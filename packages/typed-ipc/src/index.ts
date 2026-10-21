// 根入口只导出类型，避免业务协议或页面代码加载 Electron 运行时。
export type {
  IpcHandlers,
  IpcEvents,
  EmptyEvents,
  Unsubscribe,
  ModuleChannel,
  IpcNamespace
} from './types'

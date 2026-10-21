import { initIpcRouter } from '@electron-brower/typed-ipc/main'
import type { IpcRequests, RendererToMainEvents } from '../../shared/ipc'
import { getMainWindow } from '../windows/main-window'

const context = { getMainWindow }

// 工厂绑定上下文；模块导入只定义路由，不注册 Electron 监听。
export const createRouter = initIpcRouter<IpcRequests, typeof context, RendererToMainEvents>({
  context
})

import type { IpcRequests, RendererToMainEvents, MainToRendererEvents } from '../../shared/ipc'
import { TypedIpcRenderer } from '@electron-brower/typed-ipc/renderer'

const ipc = new TypedIpcRenderer<IpcRequests, RendererToMainEvents, MainToRendererEvents>()

export const api = {
  getAppVersion: () => ipc.invoke('app:getVersion'),
  updateWindowSize: (width: number, height: number) =>
    ipc.invoke('window:updateSize', width, height)
}

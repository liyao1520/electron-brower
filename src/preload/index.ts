import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { UPDATE_CHANNELS, type UpdaterAPI, type UpdateState } from '../shared/updater'

// 页面仅能调用固定的更新接口，实际网络请求和安装操作均留在主进程。
const updater: UpdaterAPI = {
  getState: () => ipcRenderer.invoke(UPDATE_CHANNELS.getState),
  check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check),
  download: () => ipcRenderer.invoke(UPDATE_CHANNELS.download),
  install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
  onState: (listener) => {
    // 保存同一函数引用，确保卸载组件时只移除本次订阅，不影响其他监听方。
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => listener(state)
    ipcRenderer.on(UPDATE_CHANNELS.state, handler)
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.state, handler)
  }
}
const api = { updater }

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

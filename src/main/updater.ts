import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import electronUpdater from 'electron-updater'
import { UPDATE_CHANNELS } from '../shared/updater'
import { UpdateService } from './update-service'

/** 应用就绪后注册一次；通过回调获取当前窗口，兼容 macOS 关闭后重新创建窗口。 */
export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  const { autoUpdater } = electronUpdater
  // 开发模式须显式开启，避免日常调试意外访问线上更新或启动安装器。
  const devUpdates = !app.isPackaged && process.env.ELECTRON_UPDATER_DEV === 'true'
  autoUpdater.forceDevUpdateConfig = devUpdates
  autoUpdater.logger = console

  const service = new UpdateService(autoUpdater, {
    currentVersion: app.getVersion(),
    canInstall: app.isPackaged,
    disabledReason:
      !app.isPackaged && !devUpdates
        ? '开发模式下默认关闭更新。请使用安装版测试，或设置 ELECTRON_UPDATER_DEV=true 调试检查和下载。'
        : undefined,
    // 窗口关闭后仍可能收到下载事件，此时跳过发送，重新打开后可读取完整快照。
    onState: (state) => {
      const window = getWindow()
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(UPDATE_CHANNELS.state, state)
      }
    }
  })

  // 只接受应用主窗口主 frame 的调用，拒绝其他窗口或嵌入 frame 发起更新操作。
  const assertSender = (event: IpcMainInvokeEvent): void => {
    const window = getWindow()
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('不允许的更新请求来源。')
    }
  }

  // 固定白名单操作，不接收页面提供的 URL、通道名或安装参数。
  const operations = {
    [UPDATE_CHANNELS.getState]: () => service.getState(),
    [UPDATE_CHANNELS.check]: () => service.check(),
    [UPDATE_CHANNELS.download]: () => service.download(),
    [UPDATE_CHANNELS.install]: () => service.install()
  }
  for (const [channel, operation] of Object.entries(operations)) {
    ipcMain.handle(channel, (event) => {
      assertSender(event)
      return operation()
    })
  }
}

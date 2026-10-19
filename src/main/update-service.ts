import type { AppUpdater, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/updater'

// 只依赖更新器所需的接口，测试时可替换为事件驱动的假更新器。
type UpdaterPort = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'on'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
>

interface UpdateServiceOptions {
  currentVersion: string
  canInstall: boolean
  disabledReason?: string
  onState: (state: UpdateState) => void
}

/** 更新业务状态机：串行执行检查和下载，并将更新器事件转换为可序列化状态。 */
export class UpdateService {
  private readonly updater: UpdaterPort
  private readonly onState: UpdateServiceOptions['onState']
  private state: UpdateState
  private busy = false
  private action: 'check' | 'download' | 'install' = 'check'

  constructor(updater: UpdaterPort, options: UpdateServiceOptions) {
    this.updater = updater
    this.onState = options.onState
    this.state = {
      revision: 0,
      status: options.disabledReason ? 'disabled' : 'idle',
      currentVersion: options.currentVersion,
      canInstall: options.canInstall,
      message: options.disabledReason
    }

    // 下载和安装分别由用户确认，关闭窗口时也不会自动安装已下载的更新。
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    // 所有原生事件都在主进程处理，页面仅接收状态快照。
    updater.on('checking-for-update', () => this.patch({ status: 'checking' }))
    updater.on('update-available', (info) => this.setVersion('available', info))
    updater.on('update-not-available', () => this.patch({ status: 'not-available' }))
    updater.on('download-progress', (progress) => {
      this.patch({
        status: 'downloading',
        progress: {
          percent: Math.min(100, Math.max(0, progress.percent)),
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total
        }
      })
    })
    updater.on('update-downloaded', (info) => this.setVersion('downloaded', info))
    updater.on('error', (error) => this.fail(error))
  }

  /** 返回独立快照，防止调用方意外修改服务内部状态。 */
  getState(): UpdateState {
    return structuredClone(this.state)
  }

  /** 合并状态并通知页面；递增序号用于解决事件与 IPC 响应的到达顺序差异。 */
  private patch(change: Partial<UpdateState>): void {
    this.state = { ...this.state, ...change, revision: this.state.revision + 1 }
    this.onState(this.getState())
  }

  /** 将单版本或多版本发布说明统一成文本，由 React 按普通文本安全显示。 */
  private setVersion(status: 'available' | 'downloaded', info: UpdateInfo): void {
    const releaseNotes = Array.isArray(info.releaseNotes)
      ? info.releaseNotes.map((release) => `${release.version}\n${release.note || ''}`).join('\n\n')
      : info.releaseNotes || undefined
    this.patch({ status, latestVersion: info.version, releaseNotes, message: undefined })
  }

  /** 错误事件和异步调用失败统一进入错误状态，保留失败阶段以支持重试。 */
  private fail(error: unknown): void {
    const detail = error instanceof Error ? error.message.split('\n')[0].slice(0, 300) : '未知错误'
    this.patch({
      status: 'error',
      failedAction: this.action,
      message: `更新失败：${detail}`
    })
  }

  /** 检查新版本；已有任务或待安装更新时直接返回当前状态。 */
  async check(): Promise<UpdateState> {
    if (this.busy || ['disabled', 'downloaded', 'installing'].includes(this.state.status)) {
      return this.getState()
    }
    // 在第一个 await 前加锁，阻止快速点击或多个 IPC 请求启动重复任务。
    this.busy = true
    this.action = 'check'
    this.patch({
      status: 'checking',
      latestVersion: undefined,
      releaseNotes: undefined,
      progress: undefined,
      message: undefined,
      failedAction: undefined
    })
    try {
      const result = await this.updater.checkForUpdates()
      if (!result) this.fail(new Error('当前运行方式不支持更新检查。'))
    } catch (error) {
      this.fail(error)
    } finally {
      this.busy = false
    }
    return this.getState()
  }

  /** 仅允许下载已发现的新版本；下载失败后保留版本信息以直接重试。 */
  async download(): Promise<UpdateState> {
    const retry = this.state.status === 'error' && this.state.failedAction === 'download'
    if (this.busy || (this.state.status !== 'available' && !retry)) return this.getState()
    this.busy = true
    this.action = 'download'
    this.patch({
      status: 'downloading',
      progress: undefined,
      message: undefined,
      failedAction: undefined
    })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.fail(error)
    } finally {
      this.busy = false
    }
    return this.getState()
  }

  /** 只有安装版且安装包下载完成时，才允许退出应用并启动安装器。 */
  install(): UpdateState {
    if (this.busy || this.state.status !== 'downloaded' || !this.state.canInstall) {
      return this.getState()
    }
    this.action = 'install'
    this.patch({ status: 'installing' })
    // 延迟到下一个事件循环执行，先让安装中的状态和 IPC 响应送达页面。
    setImmediate(() => {
      try {
        this.updater.quitAndInstall(false, true)
      } catch (error) {
        this.fail(error)
      }
    })
    return this.getState()
  }
}

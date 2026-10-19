/** 主进程维护的更新阶段，渲染进程据此展示按钮、进度和错误提示。 */
export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateState {
  /** 每次状态变化递增，用于丢弃晚到的 IPC 旧快照。 */
  revision: number
  status: UpdateStatus
  currentVersion: string
  /** 开发环境即使开启更新调试，也不允许启动安装器。 */
  canInstall: boolean
  latestVersion?: string
  releaseNotes?: string
  message?: string
  /** 区分检查失败与下载失败，让下载失败可以直接重试。 */
  failedAction?: 'check' | 'download' | 'install'
  progress?: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }
}

/** preload 暴露的固定更新接口；不允许页面传入更新地址或安装包路径。 */
export interface UpdaterAPI {
  getState: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateState>
  install: () => Promise<UpdateState>
  /** 返回取消订阅函数，组件卸载时必须调用。 */
  onState: (listener: (state: UpdateState) => void) => () => void
}

/** 主进程与 preload 共用通道常量，避免两端通道名不一致。 */
export const UPDATE_CHANNELS = {
  getState: 'updater:get-state',
  check: 'updater:check',
  download: 'updater:download',
  install: 'updater:install',
  state: 'updater:state'
} as const

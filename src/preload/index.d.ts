import { ElectronAPI } from '@electron-toolkit/preload'
import type { UpdaterAPI } from '../shared/updater'

declare global {
  interface Window {
    electron: ElectronAPI
    api: { updater: UpdaterAPI }
  }
}

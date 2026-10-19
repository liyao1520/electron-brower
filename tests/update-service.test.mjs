import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { UpdateService } from '../src/main/update-service.ts'

const info = { version: '1.0.1', files: [], releaseDate: '2026-10-19', releaseNotes: '修复与改进' }

// 使用相同事件协议模拟更新器，避免测试真实下载安装包或退出应用。
function setup(options = {}) {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update')
    updater.emit('update-available', info)
    return { updateInfo: info }
  }
  updater.downloadUpdate = async () => {
    updater.emit('download-progress', {
      percent: 50,
      total: 100,
      transferred: 50,
      bytesPerSecond: 25
    })
    updater.emit('update-downloaded', info)
    return ['installer.exe']
  }
  updater.quitAndInstall = () => {
    updater.installs = (updater.installs || 0) + 1
  }
  const states = []
  const service = new UpdateService(updater, {
    currentVersion: '1.0.0',
    canInstall: true,
    onState: (state) => states.push(state),
    ...options
  })
  return { service, updater, states }
}

test('检查、下载和安装均须显式调用；重复安装只执行一次', async () => {
  const { service, updater, states } = setup()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal((await service.download()).status, 'idle')
  assert.equal(service.install().status, 'idle')
  assert.equal((await service.check()).status, 'available')
  assert.equal((await service.download()).status, 'downloaded')
  assert.equal(
    states.find((state) => state.status === 'downloading' && state.progress)?.progress.percent,
    50
  )
  assert.equal((await service.check()).status, 'downloaded')
  assert.equal(updater.installs, undefined)
  assert.equal(service.install().status, 'installing')
  service.install()
  await new Promise(setImmediate)
  assert.equal(updater.installs, 1)
})

test('开发模式默认禁用，启用调试后仍不能安装', async () => {
  const disabled = setup({ disabledReason: '开发模式', canInstall: false })
  assert.equal((await disabled.service.check()).status, 'disabled')
  assert.equal((await disabled.service.download()).status, 'disabled')
  const { service, updater } = setup({ canInstall: false })
  await service.check()
  await service.download()
  assert.equal(service.install().status, 'downloaded')
  await new Promise(setImmediate)
  assert.equal(updater.installs, undefined)
})

test('并发检查和下载不会启动重复任务', async () => {
  const { service, updater } = setup()
  let resolveCheck
  let calls = 0
  updater.checkForUpdates = () => {
    calls++
    return new Promise((resolve) => {
      resolveCheck = resolve
    })
  }
  const first = service.check()
  assert.equal((await service.check()).status, 'checking')
  assert.equal((await service.download()).status, 'checking')
  assert.equal(calls, 1)
  updater.emit('update-available', info)
  resolveCheck({ updateInfo: info })
  await first
  let resolveDownload
  updater.downloadUpdate = () => {
    calls++
    return new Promise((resolve) => {
      resolveDownload = resolve
    })
  }
  const download = service.download()
  await service.download()
  await service.check()
  assert.equal(calls, 2)
  updater.emit('update-downloaded', info)
  resolveDownload(['installer.exe'])
  await download
})

test('检查失败或没有 Release 后可以重新检查', async () => {
  const { service, updater } = setup()
  updater.checkForUpdates = async () => {
    throw new Error('No published versions')
  }
  const error = await service.check()
  assert.equal(error.status, 'error')
  assert.equal(error.failedAction, 'check')
  assert.match(error.message, /No published versions/)
  updater.checkForUpdates = async () => {
    updater.emit('update-not-available', { ...info, version: '1.0.0' })
    return { updateInfo: info }
  }
  assert.equal((await service.check()).status, 'not-available')
  assert.equal(service.getState().message, undefined)
})

test('下载失败可以重试，错误事件和 Promise 拒绝均得到处理', async () => {
  const { service, updater } = setup()
  await service.check()
  updater.downloadUpdate = async () => {
    const error = new Error('network timeout')
    updater.emit('error', error)
    throw error
  }
  assert.equal((await service.download()).failedAction, 'download')
  assert.equal(service.getState().latestVersion, '1.0.1')
  updater.downloadUpdate = async () => {
    updater.emit('update-downloaded', info)
    return []
  }
  assert.equal((await service.download()).status, 'downloaded')
})

test('状态快照隔离，并以递增版本号同步 UI', async () => {
  const { service, states } = setup()
  const snapshot = service.getState()
  snapshot.status = 'downloaded'
  assert.equal(service.getState().status, 'idle')
  await service.check()
  await service.download()
  assert.ok(
    states.every((state, index) => index === 0 || state.revision > states[index - 1].revision)
  )
})

test('更新器被禁用返回 null 时明确显示错误', async () => {
  const { service, updater } = setup()
  updater.checkForUpdates = async () => null
  assert.equal((await service.check()).status, 'error')
})

test('安装异常会返回错误状态', async () => {
  const { service, updater } = setup()
  await service.check()
  await service.download()
  updater.quitAndInstall = () => {
    throw new Error('Installer not found')
  }
  service.install()
  await new Promise(setImmediate)
  assert.equal(service.getState().status, 'error')
  assert.equal(service.getState().failedAction, 'install')
})

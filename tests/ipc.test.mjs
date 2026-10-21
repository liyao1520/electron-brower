/* eslint-disable @typescript-eslint/explicit-function-return-type -- node:test 使用 JavaScript。 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { setup, root as libraryRoot } from '../packages/typed-ipc/tests/helpers.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

function loadApplication({ contextIsolated = true, platform = 'win32' } = {}) {
  const ipc = setup()
  const app = new EventEmitter()
  app.whenReady = () => Promise.resolve()
  app.getVersion = () => '1.2.3'
  app.quit = () => app.emit('will-quit')
  const windows = []
  class BrowserWindow extends EventEmitter {
    static getAllWindows() {
      return windows.filter((win) => !win.destroyed)
    }
    constructor(options) {
      super()
      this.options = options
      this.destroyed = false
      this.sizes = []
      this.webContents = { setWindowOpenHandler: () => {} }
      windows.push(this)
      app.emit('browser-window-created', {}, this)
    }
    show() {
      this.visible = true
    }
    loadURL(url) {
      this.url = url
    }
    loadFile(file) {
      this.file = file
    }
    isDestroyed() {
      return this.destroyed
    }
    setSize(width, height) {
      this.sizes.push([width, height])
    }
    close() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  const exposed = {}
  const page = {}
  const modules = new Map()
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    })
    vm.runInNewContext(
      outputText,
      {
        exports: module.exports,
        module,
        __dirname: path.dirname(filename),
        process: { platform, env: {}, contextIsolated },
        window: page,
        console,
        require: (name) => {
          if (name === 'electron')
            return {
              app,
              BrowserWindow,
              ipcMain: ipc.ipcMain,
              ipcRenderer: ipc.ipcRenderer,
              shell: { openExternal: () => {} },
              contextBridge: {
                exposeInMainWorld: (key, value) => {
                  exposed[key] = value
                }
              }
            }
          if (name === '@electron-toolkit/utils')
            return {
              electronApp: { setAppUserModelId: () => {} },
              optimizer: { watchWindowShortcuts: () => {} },
              is: { dev: false }
            }
          if (name === '@electron-toolkit/preload') return { electronAPI: {} }
          if (name === '@electron-brower/typed-ipc/main')
            return ipc.load(path.join(libraryRoot, 'dist/main/index.js'))
          if (name === '@electron-brower/typed-ipc/renderer')
            return ipc.load(path.join(libraryRoot, 'dist/renderer/index.js'))
          if (name === 'path') return path
          if (name.endsWith('?asset')) return { default: 'icon.png' }
          const target = path.resolve(path.dirname(filename), name)
          return load(existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, 'index.ts'))
        }
      },
      { filename }
    )
    return module.exports
  }
  return { ...ipc, app, windows, exposed, page, load, BrowserWindow }
}

for (const contextIsolated of [true, false]) {
  test(`business routers connect the preload API to the current window (isolation=${contextIsolated})`, async () => {
    const env = loadApplication({ contextIsolated, platform: 'darwin' })
    env.load(path.join(root, 'src/main/index.ts'))
    await Promise.resolve()
    env.load(path.join(root, 'src/preload/index.ts'))
    const api = (contextIsolated ? env.exposed : env.page).api
    assert.equal(await api.getAppVersion(), '1.2.3')
    assert.deepEqual([...env.handlers.keys()].sort(), ['app:getVersion', 'window:updateSize'])
    await api.updateWindowSize(1000, 700)
    assert.deepEqual(env.windows[0].sizes, [[1000, 700]])
    for (const dimensions of [
      [0, 1],
      [-1, 1],
      [1.5, 1],
      [1, NaN],
      ['10', 20]
    ]) {
      await assert.rejects(api.updateWindowSize(...dimensions), /正整数/)
    }
    env.windows[0].close()
    await assert.rejects(api.updateWindowSize(900, 600), /主窗口不可用/)
    env.app.emit('activate')
    assert.equal(env.windows.length, 2)
    await api.updateWindowSize(900, 600)
    assert.deepEqual(env.windows[1].sizes, [[900, 600]])
    assert.equal(env.handlers.size, 2)
    env.windows[1].destroyed = true
    await assert.rejects(api.updateWindowSize(900, 600), /主窗口不可用/)
  })
}

test('closing an older window does not clear the current main window', () => {
  const env = loadApplication()
  const { createMainWindow, getMainWindow } = env.load(
    path.join(root, 'src/main/windows/main-window.ts')
  )
  const first = createMainWindow()
  const second = createMainWindow()
  first.close()
  assert.equal(getMainWindow(), second)
  second.close()
  assert.equal(getMainWindow(), null)
})

test('business router imports do not register handlers before the application mounts them', () => {
  const env = loadApplication()
  const { registerIpcRouters } = env.load(path.join(root, 'src/main/ipc/index.ts'))
  assert.equal(env.handlers.size, 0)
  registerIpcRouters()
  assert.equal(env.handlers.size, 2)
})

test('duplicate startup preserves the active business handlers', async () => {
  const env = loadApplication()
  const { registerIpcRouters } = env.load(path.join(root, 'src/main/ipc/index.ts'))
  registerIpcRouters()
  assert.throws(() => registerIpcRouters(), /already registered/)
  assert.equal(env.handlers.size, 2)
  assert.equal(await env.renderer.invoke('app:getVersion'), '1.2.3')
})

// 显式启用，确保只在完成本次构建后验证产物，避免误用旧 bundle。
if (process.env.IPC_TEST_BUNDLE === '1') {
  for (const contextIsolated of [true, false]) {
    test(`production bundles include the local library and work together (isolation=${contextIsolated})`, async () => {
      const mainFile = path.join(root, 'out/main/index.js')
      const preloadFile = path.join(root, 'out/preload/index.js')
      const mainSource = readFileSync(mainFile, 'utf8')
      const preloadSource = readFileSync(preloadFile, 'utf8')
      assert.doesNotMatch(mainSource, /require\(["']@electron-brower\/typed-ipc/)
      assert.doesNotMatch(preloadSource, /require\(["']@electron-brower\/typed-ipc/)
      assert.doesNotMatch(mainSource, /TypedIpcRenderer/)
      assert.doesNotMatch(mainSource, /IpcRouterManager/)
      assert.doesNotMatch(preloadSource, /TypedIpcMain|IpcRouterManager/)
      const env = loadApplication({ contextIsolated, platform: 'darwin' })
      env.load(mainFile)
      await Promise.resolve()
      env.load(preloadFile)
      const api = (contextIsolated ? env.exposed : env.page).api
      assert.equal(await api.getAppVersion(), '1.2.3')
      await api.updateWindowSize(1000, 700)
      assert.deepEqual(env.windows[0].sizes, [[1000, 700]])
      assert.equal(
        env.windows[0].options.webPreferences.preload,
        path.join(root, 'out/preload/index.js')
      )
      env.windows[0].close()
      env.app.emit('activate')
      await api.updateWindowSize(900, 600)
      assert.deepEqual(env.windows[1].sizes, [[900, 600]])
    })
  }
}

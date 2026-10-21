/* eslint-disable @typescript-eslint/explicit-function-return-type -- node:test 使用 JavaScript。 */
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const root = fileURLToPath(new URL('../', import.meta.url))

export function setup({ logger = console } = {}) {
  const ipcMain = new EventEmitter()
  const ipcRenderer = new EventEmitter()
  const handlers = new Map()
  const mainEvent = { sender: 'renderer' }
  const rendererEvent = { sender: 'main' }
  ipcMain.handle = (channel, listener) => {
    if (handlers.has(channel)) throw new Error('Handler already registered')
    handlers.set(channel, listener)
  }
  ipcMain.handleOnce = (channel, listener) => {
    ipcMain.handle(channel, (...args) => {
      handlers.delete(channel)
      return listener(...args)
    })
  }
  ipcMain.removeHandler = (channel) => handlers.delete(channel)
  ipcRenderer.invoke = async (channel, ...args) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error('No handler registered')
    return handler(mainEvent, ...args)
  }
  ipcRenderer.send = (channel, ...args) => ipcMain.emit(channel, mainEvent, ...args)
  const target = { send: (channel, ...args) => ipcRenderer.emit(channel, rendererEvent, ...args) }

  // 测试实际编译产物；仅 mock Electron，不依赖应用源码或应用构建配置。
  const modules = new Map()
  const loadedElectronKeys = new Set()
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    vm.runInNewContext(
      readFileSync(filename, 'utf8'),
      {
        module,
        exports: module.exports,
        console: logger,
        require: (name) => {
          if (name === 'electron')
            return new Proxy(
              { ipcMain, ipcRenderer },
              {
                get(target, key) {
                  loadedElectronKeys.add(key)
                  return target[key]
                }
              }
            )
          return load(path.resolve(path.dirname(filename), `${name}.js`))
        }
      },
      { filename }
    )
    return module.exports
  }
  const mainExports = load(path.join(root, 'dist/main/index.js'))
  const rendererExports = load(path.join(root, 'dist/renderer/index.js'))
  return {
    ...mainExports,
    ...rendererExports,
    main: new mainExports.TypedIpcMain(),
    renderer: new rendererExports.TypedIpcRenderer(),
    ipcMain,
    ipcRenderer,
    handlers,
    mainEvent,
    rendererEvent,
    target,
    load,
    loadedElectronKeys
  }
}

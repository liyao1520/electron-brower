/* eslint-disable @typescript-eslint/explicit-function-return-type -- node:test 使用 JavaScript。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { setup } from './helpers.mjs'

test('handle/invoke forward arguments, resolve sync/async results and propagate errors', async () => {
  const { main, renderer, mainEvent } = setup()
  main.handle('sum', (event, a, b) => {
    assert.equal(event, mainEvent)
    return a + b
  })
  assert.equal(await renderer.invoke('sum', 2, 3), 5)
  main.handle('async', async () => 'done')
  assert.equal(await renderer.invoke('async'), 'done')
  main.handle('failure', async () => {
    throw new Error('Failed request')
  })
  await assert.rejects(renderer.invoke('failure'), /Failed request/)
  assert.throws(() => main.handle('sum', () => 0), /already registered/)
})

test('handleOnce is removed before its asynchronous result settles', async () => {
  const { main, renderer } = setup()
  main.handleOnce('token', async (_event, value) => value)
  const first = renderer.invoke('token', 'secret')
  await assert.rejects(renderer.invoke('token', 'again'), /No handler/)
  assert.equal(await first, 'secret')
})

test('removeHandler only removes requests and permits registering them again', async () => {
  const { main, renderer } = setup()
  let notifications = 0
  main.on('shared-name', () => notifications++)
  main.handle('shared-name', () => 'first')
  main.removeHandler('shared-name')
  main.removeHandler('shared-name')
  await assert.rejects(renderer.invoke('shared-name'), /No handler/)
  renderer.send('shared-name')
  assert.equal(notifications, 1)
  main.handle('shared-name', () => 'second')
  assert.equal(await renderer.invoke('shared-name'), 'second')
})

test('send uses the supplied target and renderer listeners only receive payloads', () => {
  const { main, renderer, target, mainEvent } = setup()
  const inbound = []
  const outbound = []
  const otherTargetMessages = []
  main.on('notify', (...args) => inbound.push(args))
  renderer.on('progress', (...args) => outbound.push(args))
  renderer.send('notify', 'task', { ready: true })
  main.send(target, 'progress', 50, 'task')
  main.send({ send: (...args) => otherTargetMessages.push(args) }, 'progress', 80)
  assert.deepEqual(inbound, [[mainEvent, 'task', { ready: true }]])
  assert.deepEqual(outbound, [[50, 'task']])
  assert.deepEqual(otherTargetMessages, [['progress', 80]])
})

test('handler unsubscribe does not remove a replacement registered by another instance', async () => {
  const { main, renderer, TypedIpcMain } = setup()
  const removeOriginal = main.handle('version', () => 'original')
  main.removeHandler('version')
  const other = new TypedIpcMain()
  const removeReplacement = other.handle('version', () => 'replacement')
  removeOriginal()
  removeOriginal()
  assert.equal(await renderer.invoke('version'), 'replacement')
  removeReplacement()
  removeReplacement()
  await assert.rejects(renderer.invoke('version'), /No handler/)
})

for (const side of ['main', 'renderer']) {
  function setupListener() {
    const context = setup()
    return {
      wrapper: context[side],
      bus: context[side === 'main' ? 'ipcMain' : 'ipcRenderer'],
      createOther: () => new context[side === 'main' ? 'TypedIpcMain' : 'TypedIpcRenderer']()
    }
  }

  test(`${side}: each unsubscribe is idempotent and only removes its own registration`, () => {
    const { wrapper, bus } = setupListener()
    let calls = 0
    const listener = () => calls++
    const first = wrapper.on('event', listener)
    const second = wrapper.on('event', listener)
    bus.emit('event', {}, 1)
    assert.equal(calls, 2)
    first()
    first()
    assert.equal(bus.listenerCount('event'), 1)
    bus.emit('event', {}, 2)
    assert.equal(calls, 3)
    second()
    assert.equal(bus.listenerCount('event'), 0)
  })

  test(`${side}: off removes the latest matching subscription without affecting other owners`, () => {
    const { wrapper, bus, createOther } = setupListener()
    let calls = 0
    const listener = () => calls++
    const persistent = wrapper.on('event', listener)
    const once = wrapper.once('event', listener)
    const otherChannel = wrapper.on('other', listener)
    const otherOwner = createOther().on('event', listener)
    wrapper.off('event', listener)
    once()
    bus.emit('event', {})
    bus.emit('event', {})
    assert.equal(calls, 4)
    wrapper.off('event', listener)
    wrapper.off('event', listener)
    assert.equal(bus.listenerCount('event'), 1)
    assert.equal(bus.listenerCount('other'), 1)
    persistent()
    otherChannel()
    otherOwner()
    assert.equal(bus.listenerCount('event'), 0)
  })

  test(`${side}: once can be cancelled and executes at most once during nested emits`, () => {
    const { wrapper, bus } = setupListener()
    let calls = 0
    const cancelled = wrapper.once('cancelled', () => calls++)
    cancelled()
    bus.emit('cancelled', {})
    assert.equal(calls, 0)

    // 嵌套 emit 在外层事件执行到 once 监听器前触发。
    bus.once('event', () => bus.emit('event', {}))
    const unsubscribe = wrapper.once('event', () => calls++)
    bus.emit('event', {})
    bus.emit('event', {})
    assert.equal(calls, 1)
    assert.equal(bus.listenerCount('event'), 0)
    unsubscribe()
  })

  test(`${side}: once releases its subscription even when the callback throws`, () => {
    const { wrapper, bus } = setupListener()
    const listener = () => {
      throw new Error('Listener failed')
    }
    const unsubscribe = wrapper.once('event', listener)
    assert.throws(() => bus.emit('event', {}), /Listener failed/)
    assert.equal(bus.listenerCount('event'), 0)
    wrapper.off('event', listener)
    unsubscribe()
    bus.emit('event', {})
  })
}

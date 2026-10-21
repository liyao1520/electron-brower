import assert from 'node:assert/strict'
import test from 'node:test'
import { setup } from './helpers.mjs'

test('routers are inert until self-registered and preserve requests, events and context', async () => {
  const { initIpcRouter, renderer, ipcMain, mainEvent, main, target } = setup()
  const context = { version: '1.0.0' }
  const createRouter = initIpcRouter({ context })
  assert.equal(typeof createRouter, 'function')
  assert.deepEqual(Object.keys(createRouter), [])
  const notifications = []
  const calls = []
  const router = createRouter('app')
  assert.equal(
    router.handle('app:version', (call) => {
      calls.push(call)
      return call.ctx.version
    }),
    router
  )
  router
    .handleOnce('app:token', async ({ event, ctx }, id) => {
      assert.equal(event, mainEvent)
      assert.equal(ctx, context)
      return id
    })
    .on('app:notify', (call, value) => notifications.push([call.event, value]))
    .once('app:ready', () => notifications.push('ready'))
  await assert.rejects(renderer.invoke('app:version'), /No handler/)
  assert.equal(ipcMain.listenerCount('app:notify'), 0)
  const unsubscribe = router.register()
  assert.equal(await renderer.invoke('app:version'), '1.0.0')
  assert.equal(await renderer.invoke('app:version'), '1.0.0')
  assert.notEqual(calls[0], calls[1])
  assert.equal(calls[0].ctx, context)
  assert.equal(calls[0].event, mainEvent)
  assert.equal(Object.hasOwn(mainEvent, 'ctx'), false)
  assert.equal(await renderer.invoke('app:token', 'secret'), 'secret')
  await assert.rejects(renderer.invoke('app:token', 'again'), /No handler/)
  renderer.send('app:notify', 'task')
  renderer.send('app:ready')
  renderer.send('app:ready')
  assert.deepEqual(notifications, [[mainEvent, 'task'], 'ready'])
  const pushed = []
  renderer.on('app:progress', (value) => pushed.push(value))
  main.send(target, 'app:progress', 50)
  assert.deepEqual(pushed, [50])
  unsubscribe()
  unsubscribe()
  assert.equal(ipcMain.listenerCount('app:notify'), 0)
  assert.equal(ipcMain.listenerCount('app:ready'), 0)
  await assert.rejects(renderer.invoke('app:version'), /No handler/)
})

test('context getters resolve replacement windows without registering the router again', async () => {
  const { initIpcRouter, renderer } = setup()
  let current = { id: 1 }
  const createRouter = initIpcRouter({ context: { getWindow: () => current } })
  const router = createRouter('window').handle('window:id', ({ ctx }) => ctx.getWindow()?.id)
  const unsubscribe = router.register()
  assert.equal(await renderer.invoke('window:id'), 1)
  current = null
  assert.equal(await renderer.invoke('window:id'), undefined)
  current = { id: 2 }
  assert.equal(await renderer.invoke('window:id'), 2)
  unsubscribe()
})

test('namespace, duplicate request and mounted definition checks also work at runtime', () => {
  const { initIpcRouter } = setup()
  const createRouter = initIpcRouter({ context: {} })
  assert.throws(() => createRouter(''), /Invalid IPC namespace/)
  assert.throws(() => createRouter('app:nested'), /Invalid IPC namespace/)
  const router = createRouter('app')
  assert.throws(() => router.handle('window:resize', () => {}), /does not belong/)
  assert.throws(() => router.on('app:', () => {}), /does not belong/)
  router.handle('app:version', () => '1')
  assert.throws(() => router.handleOnce('app:version', () => '2'), /already defined/)
  const unsubscribe = router.register()
  assert.throws(() => router.on('app:event', () => {}), /Cannot modify/)
  unsubscribe()
  assert.doesNotThrow(() => router.on('app:event', () => {}))
})

test('duplicate registration fails and an old cancellation cannot remove a new mount', () => {
  const { initIpcRouter, ipcMain } = setup()
  const createRouter = initIpcRouter({ context: {} })
  const router = createRouter('app').on('app:event', () => {})
  const removeFirst = router.register()
  assert.throws(() => router.register(), /already registered/)
  assert.equal(ipcMain.listenerCount('app:event'), 1)
  removeFirst()
  const removeSecond = router.register()
  removeFirst()
  assert.equal(ipcMain.listenerCount('app:event'), 1)
  assert.throws(() => router.register(), /already registered/)
  removeSecond()
  removeSecond()
  assert.equal(ipcMain.listenerCount('app:event'), 0)
})

test('routers from different factories retain their context through unregister and remount', async () => {
  const { initIpcRouter, renderer } = setup()
  const first = initIpcRouter({ context: { version: 'first' } })('app').handle(
    'app:first',
    ({ ctx }) => ctx.version
  )
  const second = initIpcRouter({ context: { version: 'second' } })('app').handle(
    'app:second',
    ({ ctx }) => ctx.version
  )
  const removeFirst = first.register()
  const removeSecond = second.register()
  assert.equal(await renderer.invoke('app:first'), 'first')
  assert.equal(await renderer.invoke('app:second'), 'second')
  removeSecond()
  removeFirst()
  const removeRemounted = first.register()
  assert.equal(await renderer.invoke('app:first'), 'first')
  removeRemounted()
})

test('unregistering a consumed handleOnce preserves a replacement from another router', async () => {
  const { initIpcRouter, renderer } = setup()
  const createRouter = initIpcRouter({ context: {} })
  const first = createRouter('app').handleOnce('app:token', () => 'first')
  const removeFirst = first.register()
  assert.equal(await renderer.invoke('app:token'), 'first')
  const second = createRouter('app').handle('app:token', () => 'replacement')
  const removeSecond = second.register()
  removeFirst()
  assert.equal(await renderer.invoke('app:token'), 'replacement')
  removeSecond()
})

test('failed router registration rolls back its own handlers and preserves existing ones', async () => {
  const { initIpcRouter, renderer, main } = setup()
  const removeExisting = main.handle('app:existing', () => 'outside')
  const createRouter = initIpcRouter({ context: {} })
  const router = createRouter('app')
    .handle('app:fresh', () => 'new')
    .handle('app:existing', () => 'inside')
  assert.throws(() => router.register(), /already registered/)
  await assert.rejects(renderer.invoke('app:fresh'), /No handler/)
  assert.equal(await renderer.invoke('app:existing'), 'outside')
  removeExisting()
  const unsubscribe = router.register()
  assert.equal(await renderer.invoke('app:fresh'), 'new')
  unsubscribe()
})

test('event registration failure rolls back earlier handlers and event subscriptions', async () => {
  const { initIpcRouter, renderer, ipcMain, main } = setup()
  const once = ipcMain.once
  ipcMain.once = () => {
    throw new Error('Cannot attach event')
  }
  const outside = main.on('app:notify', () => {})
  const createRouter = initIpcRouter({ context: {} })
  const router = createRouter('app')
    .handle('app:version', () => '1.0.0')
    .on('app:notify', () => {})
    .once('app:ready', () => {})
  assert.throws(() => router.register(), /Cannot attach event/)
  assert.equal(ipcMain.listenerCount('app:notify'), 1)
  await assert.rejects(renderer.invoke('app:version'), /No handler/)
  ipcMain.once = once
  const unsubscribe = router.register()
  unsubscribe()
  assert.equal(ipcMain.listenerCount('app:notify'), 1)
  outside()
})

test('cancelling one router preserves handlers and subscriptions owned by another', async () => {
  const { initIpcRouter, renderer, ipcMain } = setup()
  const createRouter = initIpcRouter({ context: {} })
  const first = createRouter('app')
    .handle('app:first', () => 'first')
    .on('app:event', () => {})
  const untouched = createRouter('app')
    .handle('app:untouched', () => 'outside')
    .on('app:event', () => {})
  const removeFirst = first.register()
  const removeUntouched = untouched.register()
  removeFirst()
  removeFirst()
  await assert.rejects(renderer.invoke('app:first'), /No handler/)
  assert.equal(await renderer.invoke('app:untouched'), 'outside')
  assert.equal(ipcMain.listenerCount('app:event'), 1)
  removeUntouched()
})

test('router cleanup continues in reverse order after errors and permits subsequent registration', () => {
  const { initIpcRouter, ipcMain } = setup()
  const createRouter = initIpcRouter({ context: {} })
  const router = createRouter('app')
    .handle('app:first', () => {})
    .handle('app:second', () => {})
    .handle('app:third', () => {})
  const unsubscribe = router.register()
  const removeHandler = ipcMain.removeHandler
  const removed = []
  ipcMain.removeHandler = (channel) => {
    removed.push(channel)
    removeHandler(channel)
    if (channel === 'app:second') throw new Error('Cleanup failed')
  }
  assert.throws(unsubscribe, (error) => {
    assert.equal(error.errors[0].message, 'Cleanup failed')
    return true
  })
  assert.deepEqual(removed, ['app:third', 'app:second', 'app:first'])
  unsubscribe()
  assert.equal(removed.length, 3)
  ipcMain.removeHandler = removeHandler
  const removeRemounted = router.register()
  removeRemounted()
})

test('registration and rollback errors are both retained', () => {
  const { initIpcRouter, ipcMain } = setup()
  const createRouter = initIpcRouter({ context: {} })
  const router = createRouter('app')
    .handle('app:first', () => {})
    .handle('app:second', () => {})
  const registrationError = new Error('Registration failed')
  const cleanupError = new Error('Cleanup failed')
  const handle = ipcMain.handle
  ipcMain.handle = (channel, listener) => {
    if (channel === 'app:second') throw registrationError
    handle(channel, listener)
  }
  ipcMain.removeHandler = () => {
    throw cleanupError
  }
  assert.throws(
    () => router.register(),
    (error) => {
      assert.equal(error.errors[0], registrationError)
      assert.equal(error.errors[1].errors[0], cleanupError)
      return true
    }
  )
})

test('separate registrations remain independent when a later router fails', async () => {
  const { initIpcRouter, renderer } = setup()
  const createRouter = initIpcRouter({ context: {} })
  const first = createRouter('app').handle('app:existing', () => 'outside')
  const conflict = createRouter('app')
    .handle('app:new', () => 'new')
    .handle('app:existing', () => 'inside')
  const removeFirst = first.register()
  assert.throws(() => conflict.register(), /already registered/)
  await assert.rejects(renderer.invoke('app:new'), /No handler/)
  assert.equal(await renderer.invoke('app:existing'), 'outside')
  removeFirst()
})

test('a router rejects reentrant registration while its own cleanup is running', () => {
  const { initIpcRouter, ipcMain } = setup()
  const router = initIpcRouter({ context: {} })('app').handle('app:version', () => '1')
  const unsubscribe = router.register()
  const remove = ipcMain.removeHandler
  ipcMain.removeHandler = (channel) => {
    assert.throws(() => router.register(), /already registered/)
    unsubscribe()
    remove(channel)
  }
  unsubscribe()
})

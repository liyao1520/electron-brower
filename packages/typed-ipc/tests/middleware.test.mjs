/* eslint-disable @typescript-eslint/explicit-function-return-type -- node:test 使用 JavaScript。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { setup } from './helpers.mjs'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('global and local middleware surround the handler in order and preserve its result', async () => {
  const { initIpcRouter, renderer, mainEvent } = setup()
  const trace = []
  const calls = []
  const context = { version: '1.2.3' }
  const middleware = (name) => async (call, next) => {
    calls.push(call)
    trace.push(`${name}:before`)
    try {
      return await next()
    } finally {
      trace.push(`${name}:after`)
    }
  }
  const createRouter = initIpcRouter({
    context,
    middlewares: [middleware('global-1'), middleware('global-2')]
  })
  const router = createRouter('app').handle('app:version', (call, suffix) => {
    assert.equal(call, calls[0])
    trace.push('handler')
    return `${call.ctx.version}${suffix}`
  })
  // 在 handle 定义之后添加的中间件也作用于该通道。
  assert.equal(router.use(middleware('local-1'), middleware('local-2')), router)
  assert.deepEqual(trace, [])
  const unsubscribe = router.register()
  assert.deepEqual(trace, [])
  assert.equal(await renderer.invoke('app:version', '!'), '1.2.3!')
  assert.deepEqual(trace, [
    'global-1:before',
    'global-2:before',
    'local-1:before',
    'local-2:before',
    'handler',
    'local-2:after',
    'local-1:after',
    'global-2:after',
    'global-1:after'
  ])
  assert.ok(calls.every((call) => call === calls[0]))
  assert.equal(calls[0].kind, 'invoke')
  assert.equal(calls[0].channel, 'app:version')
  assert.deepEqual([...calls[0].args], ['!'])
  assert.equal(calls[0].ctx, context)
  assert.equal(calls[0].event, mainEvent)
  assert.equal(Object.hasOwn(mainEvent, 'ctx'), false)
  unsubscribe()
})

test('global arrays are snapshotted and local middleware never leaks to other routers or factories', async () => {
  const { initIpcRouter, renderer } = setup()
  const trace = []
  const global = async ({ channel }, next) => {
    trace.push(`global:${channel}`)
    return await next()
  }
  const globals = [global]
  const createRouter = initIpcRouter({ context: {}, middlewares: globals })
  globals.push(async () => {
    throw new Error('External mutation')
  })
  const first = createRouter('app').handle('app:first', () => 1)
  first.use(async ({ channel }, next) => {
    trace.push(`local:${channel}`)
    return await next()
  })
  const second = createRouter('window').handle('window:second', () => 2)
  const independent = initIpcRouter({ context: {} })('app').handle('app:third', () => 3)
  const cleanups = [first.register(), second.register(), independent.register()]
  assert.equal(await renderer.invoke('app:first'), 1)
  assert.equal(await renderer.invoke('window:second'), 2)
  assert.equal(await renderer.invoke('app:third'), 3)
  assert.deepEqual(trace, ['global:app:first', 'local:app:first', 'global:window:second'])
  for (const cleanup of cleanups) cleanup()
})

for (const position of ['global', 'local', 'handler', 'after']) {
  test(`request errors from ${position} propagate to invoke and unwind outer middleware`, async () => {
    const { initIpcRouter, renderer } = setup()
    const failure = new Error(position)
    let handlerCalls = 0
    let finallyCalls = 0
    let eventErrors = 0
    const createRouter = initIpcRouter({
      context: {},
      middlewares: [
        async (_call, next) => {
          try {
            if (position === 'global') throw failure
            return await next()
          } finally {
            finallyCalls++
          }
        }
      ],
      onError: () => {
        eventErrors++
      }
    })
    const router = createRouter('app')
      .use(async (_call, next) => {
        if (position === 'local') throw failure
        const result = await next()
        if (position === 'after') throw failure
        return result
      })
      .handle('app:run', async () => {
        handlerCalls++
        if (position === 'handler') throw failure
        return 'ok'
      })
    const unsubscribe = router.register()
    await assert.rejects(renderer.invoke('app:run'), (error) => error === failure)
    assert.equal(handlerCalls, ['handler', 'after'].includes(position) ? 1 : 0)
    assert.equal(finallyCalls, 1)
    assert.equal(eventErrors, 0)
    unsubscribe()
  })
}

test('calling next twice rejects without executing the handler twice', async () => {
  const { initIpcRouter, renderer } = setup()
  let calls = 0
  const router = initIpcRouter({ context: {} })('app')
    .use(async (_call, next) => {
      await next()
      return next()
    })
    .handle('app:run', () => ++calls)
  const unsubscribe = router.register()
  await assert.rejects(renderer.invoke('app:run'), /next\(\) called multiple times/)
  assert.equal(calls, 1)
  unsubscribe()
})

test('concurrent calls keep independent middleware positions and call metadata', async () => {
  const { initIpcRouter, renderer } = setup()
  const firstGate = deferred()
  const secondGate = deferred()
  const calls = []
  const finished = []
  const router = initIpcRouter({ context: {} })('app')
    .use(async (call, next) => {
      calls.push(call)
      await (call.args[0] === 1 ? firstGate.promise : secondGate.promise)
      const result = await next()
      finished.push(call.args[0])
      return result
    })
    .handle('app:run', async (_call, id) => id * 10)
  const unsubscribe = router.register()
  const first = renderer.invoke('app:run', 1)
  const second = renderer.invoke('app:run', 2)
  assert.notEqual(calls[0], calls[1])
  assert.notEqual(calls[0].args, calls[1].args)
  secondGate.resolve()
  assert.equal(await second, 20)
  assert.deepEqual(finished, [2])
  firstGate.resolve()
  assert.equal(await first, 10)
  assert.deepEqual(finished, [2, 1])
  unsubscribe()
})

test('middleware changes require unregistration and cannot alter an in-flight call', async () => {
  const { initIpcRouter, renderer } = setup()
  const gate = deferred()
  const localCalls = []
  const router = initIpcRouter({
    context: {},
    middlewares: [
      async ({ args }, next) => {
        if (args[0] === 'old') await gate.promise
        return await next()
      }
    ]
  })('app').handle('app:run', (_call, value) => value)
  const removeOld = router.register()
  assert.throws(() => router.use(async (_call, next) => next()), /Cannot modify/)
  const oldRequest = renderer.invoke('app:run', 'old')
  removeOld()
  router.use(async ({ args }, next) => {
    localCalls.push(args[0])
    return await next()
  })
  const removeNew = router.register()
  removeOld()
  assert.equal(await renderer.invoke('app:run', 'new'), 'new')
  gate.resolve()
  assert.equal(await oldRequest, 'old')
  assert.deepEqual(localCalls, ['new'])
  removeNew()
})

for (const denied of [false, true]) {
  test(`handleOnce is consumed before asynchronous middleware settles (denied=${denied})`, async () => {
    const { initIpcRouter, renderer } = setup()
    const gate = deferred()
    let handlerCalls = 0
    const router = initIpcRouter({ context: {} })('app')
      .use(async (_call, next) => {
        await gate.promise
        if (denied) throw new Error('Denied')
        return await next()
      })
      .handleOnce('app:run', () => ++handlerCalls)
    const unsubscribe = router.register()
    const first = renderer.invoke('app:run')
    await assert.rejects(renderer.invoke('app:run'), /No handler/)
    gate.resolve()
    if (denied) await assert.rejects(first, /Denied/)
    else assert.equal(await first, 1)
    assert.equal(handlerCalls, denied ? 0 : 1)
    unsubscribe()
  })
}

test('event middleware awaits asynchronous listeners and once is consumed before middleware runs', async () => {
  const { initIpcRouter, renderer, ipcMain, mainEvent } = setup()
  const gate = deferred()
  const trace = []
  const calls = []
  const createRouter = initIpcRouter({
    context: {},
    middlewares: [
      async (call, next) => {
        calls.push(call)
        trace.push(`${call.channel}:global-before`)
        await gate.promise
        const result = await next()
        trace.push(`${call.channel}:global-after`)
        return result
      }
    ]
  })
  const router = createRouter('app').use(async (call, next) => {
    trace.push(`${call.channel}:local-before`)
    const result = await next()
    trace.push(`${call.channel}:local-after`)
    return result
  })
  const listener =
    (channel) =>
    async ({ event }, value) => {
      assert.equal(event, mainEvent)
      assert.equal(value, 42)
      await Promise.resolve()
      trace.push(`${channel}:handler`)
    }
  router.on('app:notify', listener('app:notify')).once('app:ready', listener('app:ready'))
  const unsubscribe = router.register()
  renderer.send('app:notify', 42)
  renderer.send('app:ready', 42)
  renderer.send('app:ready', 42)
  assert.equal(ipcMain.listenerCount('app:ready'), 0)
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => call.kind === 'event' && call.event === mainEvent))
  gate.resolve()
  await setImmediate()
  for (const channel of ['app:notify', 'app:ready']) {
    assert.deepEqual(
      trace.filter((entry) => entry.startsWith(channel)),
      [
        `${channel}:global-before`,
        `${channel}:local-before`,
        `${channel}:handler`,
        `${channel}:local-after`,
        `${channel}:global-after`
      ]
    )
  }
  unsubscribe()
})

for (const method of ['on', 'once']) {
  for (const position of ['middleware', 'handler']) {
    test(`${method} reports asynchronous ${position} failures with the event context`, async () => {
      const { initIpcRouter, renderer, mainEvent } = setup()
      const reported = []
      const failure = new Error('Event failed')
      const context = { version: '1' }
      const router = initIpcRouter({
        context,
        onError: async (error, call) => {
          await Promise.resolve()
          reported.push({ error, call })
        }
      })('app').use(async (_call, next) => {
        await Promise.resolve()
        if (position === 'middleware') throw failure
        return await next()
      })
      router[method]('app:notify', async () => {
        await Promise.resolve()
        throw failure
      })
      const unsubscribe = router.register()
      assert.doesNotThrow(() => renderer.send('app:notify', 123))
      await setImmediate()
      assert.equal(reported.length, 1)
      assert.equal(reported[0].error, failure)
      assert.equal(reported[0].call.kind, 'event')
      assert.equal(reported[0].call.ctx, context)
      assert.equal(reported[0].call.event, mainEvent)
      assert.equal(reported[0].call.channel, 'app:notify')
      assert.deepEqual([...reported[0].call.args], [123])
      unsubscribe()
    })
  }
}

for (const reporter of ['default', 'throws', 'rejects']) {
  test(`event errors remain observable when onError ${reporter}`, async () => {
    const logs = []
    const { initIpcRouter, renderer } = setup({ logger: { error: (...args) => logs.push(args) } })
    const failure = new Error('Event failed')
    const reportingFailure = new Error('Reporter failed')
    const onError =
      reporter === 'default'
        ? undefined
        : reporter === 'throws'
          ? () => {
              throw reportingFailure
            }
          : async () => {
              throw reportingFailure
            }
    const router = initIpcRouter({ context: {}, onError })('app').on('app:notify', () => {
      throw failure
    })
    const unsubscribe = router.register()
    assert.doesNotThrow(() => renderer.send('app:notify'))
    await setImmediate()
    assert.equal(logs.length, 1)
    assert.match(logs[0][0], /app:notify/)
    assert.ok(logs[0].includes(failure))
    if (reporter !== 'default') assert.ok(logs[0].includes(reportingFailure))
    unsubscribe()
  })
}

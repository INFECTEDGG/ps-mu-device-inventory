import assert from 'node:assert/strict'
import test from 'node:test'
import {
  startInventorySession, getInventorySession, touchInventorySession, endInventorySession,
  watchInventorySession, ServerSessionError,
} from '../src/lib/serverSession.ts'

const sessionId = '00000000-0000-4000-8000-000000000010'
const otherSessionId = '00000000-0000-4000-8000-000000000011'
const userId = '00000000-0000-4000-8000-000000000001'
const epoch = 1_800_000_000_000
const windowMs = 30 * 60 * 1000

function active(serverNow = epoch, expiresAt = serverNow + windowMs) {
  return { active: true, sessionId, userId, serverNow, expiresAt, reason: 'active' }
}

function inactive(reason = 'expired', serverNow = epoch, expiresAt = null) {
  return { active: false, sessionId, userId, serverNow, expiresAt, reason }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function settle() {
  for (let step = 0; step < 16; step += 1) await Promise.resolve()
}

class Runtime {
  tick = 0
  wall = epoch + 50_000_000 // Deliberately unrelated to the server's clock.
  monotonic = 0
  nextTimer = 1
  timers = new Map()
  activities = new Set()
  checks = new Set()
  monotonicNow = () => this.monotonic
  wallNow = () => this.wall
  schedule = (callback, delay) => {
    const id = this.nextTimer++
    this.timers.set(id, { at: this.tick + delay, callback })
    return id
  }
  cancel = (id) => { this.timers.delete(id) }
  listenActivity = (listener) => { this.activities.add(listener); return () => this.activities.delete(listener) }
  listenCheck = (listener) => { this.checks.add(listener); return () => this.checks.delete(listener) }
  activity(trusted = true) { for (const listener of [...this.activities]) listener(trusted) }
  check() { for (const listener of [...this.checks]) listener() }
  elapse(ms, wallDelta = ms, monotonicDelta = ms) {
    this.tick += ms
    this.wall += wallDelta
    this.monotonic += monotonicDelta
  }
  async advance(ms) {
    const target = this.tick + ms
    let iterations = 0
    while (true) {
      const next = [...this.timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next) break
      assert.ok(iterations++ < 500, 'timer loop must remain bounded')
      const [id, timer] = next
      this.timers.delete(id)
      this.elapse(Math.max(0, timer.at - this.tick))
      timer.callback()
      await settle()
    }
    this.elapse(target - this.tick)
    await settle()
  }
}

function server(runtime, initialLifetime = windowMs) {
  const state = { expiresAt: epoch + initialLifetime, revoked: false }
  const calls = []
  const client = {
    async rpc(...args) {
      const [name] = args
      calls.push({ name, args, at: runtime.tick })
      const now = epoch + runtime.tick
      if (name === 'inventory_session_end') state.revoked = true
      if (name === 'inventory_session_touch' && !state.revoked && now < state.expiresAt) state.expiresAt = now + windowMs
      return { data: state.revoked ? inactive('revoked', now, state.expiresAt)
        : now >= state.expiresAt ? inactive('expired', now, state.expiresAt)
          : active(now, state.expiresAt), error: null }
    },
  }
  return { client, state, calls }
}

async function start(runtime = new Runtime(), currentServer = server(runtime)) {
  const state = { ready: [], checking: [], expired: [], errors: [] }
  const stop = watchInventorySession({
    client: currentServer.client, sessionId, runtime,
    onReady: (value) => state.ready.push(value),
    onChecking: () => state.checking.push(runtime.tick),
    onExpired: (value) => state.expired.push(value),
    onError: (error) => state.errors.push(error),
  })
  await settle()
  return { runtime, server: currentServer, state, stop }
}

test('RPC helpers send only the function name, never client-selected IDs or activity times', async () => {
  const runtime = new Runtime()
  const current = server(runtime)
  assert.equal((await startInventorySession(current.client, sessionId)).active, true)
  assert.equal((await getInventorySession(current.client, sessionId)).active, true)
  assert.equal((await touchInventorySession(current.client, sessionId)).active, true)
  assert.equal((await endInventorySession(current.client, sessionId)).reason, 'revoked')
  assert.deepEqual(current.calls.map((call) => call.args), [
    ['inventory_session_start'], ['inventory_session_status'], ['inventory_session_touch'], ['inventory_session_end'],
  ])
})

test('missing configuration and invalid expected IDs fail before any RPC', async () => {
  let calls = 0
  const client = { rpc() { calls += 1 } }
  await assert.rejects(startInventorySession(null, sessionId), ServerSessionError)
  await assert.rejects(startInventorySession(client, 'invalid'), ServerSessionError)
  assert.equal(calls, 0)
})

test('malformed, wrong-session, and implausible responses fail closed', async () => {
  for (const data of [
    null, [], 'active', {}, { ...active(), active: 'true' },
    { ...active(), sessionId: null }, { ...active(), sessionId: otherSessionId },
    { ...active(), userId: 'admin' }, { ...active(), userId: null },
    { ...active(), serverNow: NaN }, { ...active(), serverNow: -1 },
    { ...active(), expiresAt: null }, { ...active(), expiresAt: epoch },
    { ...active(), expiresAt: epoch + windowMs + 1 }, { ...active(), expiresAt: Infinity },
    { ...active(), reason: 'revoked' }, { ...inactive(), reason: 'active' },
    { ...inactive(), sessionId: otherSessionId }, { ...inactive(), expiresAt: 'future' },
    { ...inactive(), reason: 'private-error' },
  ]) {
    const client = { rpc: async () => ({ data, error: null }) }
    await assert.rejects(getInventorySession(client, sessionId), (error) => error instanceof ServerSessionError && error.code === 'invalid_response')
  }
})

test('invalid server contexts can expire safely without exposing another identity', async () => {
  const data = { ...inactive('invalid'), sessionId: null, userId: null }
  assert.deepEqual(await getInventorySession({ rpc: async () => ({ data, error: null }) }, sessionId), data)
  await assert.rejects(endInventorySession({ rpc: async () => ({ data: active(), error: null }) }, sessionId), ServerSessionError)
})

test('transport and database failures expose only a safe public error', async () => {
  for (const client of [
    { rpc: async () => ({ data: active(), error: { message: 'private database host and token' } }) },
    { rpc: async () => { throw new Error('private database host and token') } },
    { rpc: async () => { throw { private: 'database host and token' } } },
  ]) {
    await assert.rejects(getInventorySession(client, sessionId), (error) => {
      assert.ok(error instanceof ServerSessionError)
      assert.ok(!error.message.includes('private'))
      assert.ok(!error.message.includes('token'))
      return true
    })
  }
})

test('start, background polling, and passive checks never send activity touches', async () => {
  const { runtime, server: current, state, stop } = await start()
  assert.equal(state.ready.length, 1)
  assert.equal(current.calls[0].name, 'inventory_session_start')
  await runtime.advance(90_000)
  runtime.check()
  await settle()
  assert.equal(current.calls.filter((call) => call.name === 'inventory_session_status').length, 4)
  assert.equal(current.calls.filter((call) => call.name === 'inventory_session_touch').length, 0)
  assert.equal(current.state.expiresAt, epoch + windowMs)
  stop()
})

test('only trusted input triggers leading touches, with no trailing activity timer', async () => {
  const { runtime, server: current, stop } = await start()
  await runtime.advance(1_000)
  runtime.activity(false)
  await settle()
  assert.equal(current.calls.length, 1)
  runtime.activity()
  await settle()
  for (let event = 0; event < 100; event += 1) runtime.activity()
  await runtime.advance(29_999)
  runtime.activity()
  await settle()
  assert.equal(current.calls.filter((call) => call.name === 'inventory_session_touch').length, 1)
  await runtime.advance(1)
  runtime.activity()
  await settle()
  assert.equal(current.calls.filter((call) => call.name === 'inventory_session_touch').length, 2)
  assert.equal(current.state.expiresAt, epoch + 31_000 + windowMs)
  stop()
})

test('another tab can extend the shared server deadline; local expiry checks status first', async () => {
  const runtime = new Runtime()
  const current = server(runtime, 5_000)
  const { state, stop } = await start(runtime, current)
  await runtime.advance(4_000)
  current.state.expiresAt = epoch + 60_000
  await runtime.advance(1_000)
  assert.equal(state.expired.length, 0)
  assert.equal(state.ready.at(-1).expiresAt, epoch + 60_000)
  assert.deepEqual(current.calls.map((call) => call.name), ['inventory_session_start', 'inventory_session_status'])
  stop()
})

test('deadline verification blocks the UI once while a delayed status confirms another tab extension', async () => {
  const runtime = new Runtime()
  const current = server(runtime, 5_000)
  const response = deferred()
  const rpc = current.client.rpc
  let delayed = true
  current.client.rpc = (...args) => {
    if (args[0] === 'inventory_session_status' && delayed) {
      delayed = false
      current.calls.push({ name: args[0], args, at: runtime.tick })
      return response.promise
    }
    return rpc(...args)
  }
  const { state, stop } = await start(runtime, current)
  await runtime.advance(4_999)
  assert.equal(state.checking.length, 0)
  await runtime.advance(1)
  assert.deepEqual(state.checking, [5_000])
  assert.equal(state.ready.length, 1, 'a cached ready state must not be emitted while verification is pending')
  runtime.check()
  runtime.check()
  assert.equal(state.checking.length, 1, 'checks in the same verification period are coalesced')
  current.state.expiresAt = epoch + 60_000
  response.resolve({ data: active(epoch + 5_000, current.state.expiresAt), error: null })
  await settle()
  assert.equal(state.expired.length, 0)
  assert.equal(state.ready.at(-1).expiresAt, epoch + 60_000)
  await runtime.advance(30_000)
  assert.equal(state.checking.length, 1, 'normal polls before the renewed deadline cause no UI flicker')
  stop()
})

test('authoritative inactive response expires exactly once and removes all listeners and timers', async () => {
  const runtime = new Runtime()
  const { server: current, state, stop } = await start(runtime, server(runtime, 5_000))
  await runtime.advance(5_000)
  assert.equal(state.expired.length, 1)
  assert.equal(state.expired[0].reason, 'expired')
  assert.equal(runtime.timers.size, 0)
  assert.equal(runtime.activities.size + runtime.checks.size, 0)
  runtime.activity()
  runtime.check()
  await runtime.advance(windowMs)
  stop()
  assert.equal(state.expired.length, 1)
  assert.equal(current.calls.length, 2)
})

test('late input after browser sleep performs status before touch and cannot revive expiry', async () => {
  const runtime = new Runtime()
  const current = server(runtime, 5_000)
  const { state } = await start(runtime, current)
  runtime.elapse(6_000, 6_000, 0)
  runtime.activity()
  await settle()
  assert.deepEqual(current.calls.map((call) => call.name), ['inventory_session_start', 'inventory_session_status'])
  assert.equal(state.expired.length, 1)
})

test('server failure blocks the watcher without treating cached activity as proof of a session', async () => {
  const runtime = new Runtime()
  const current = server(runtime)
  const rpc = current.client.rpc
  current.client.rpc = async (...args) => args[0] === 'inventory_session_status'
    ? { data: null, error: { message: 'private RPC failure' } }
    : rpc(...args)
  const { state } = await start(runtime, current)
  runtime.check()
  await settle()
  assert.equal(state.errors.length, 1)
  assert.ok(state.errors[0] instanceof ServerSessionError)
  assert.ok(!state.errors[0].message.includes('private'))
  assert.equal(state.expired.length, 0)
  assert.equal(runtime.timers.size, 0)
  assert.equal(runtime.activities.size + runtime.checks.size, 0)
  runtime.activity()
  await settle()
  assert.equal(current.calls.filter((call) => call.name === 'inventory_session_touch').length, 0)
})

test('cleanup suppresses a late initial RPC response and does not issue queued requests', async () => {
  const runtime = new Runtime()
  const response = deferred()
  const calls = []
  const current = { client: { rpc: (...args) => { calls.push(args); return response.promise } } }
  const { state, stop } = await start(runtime, current)
  runtime.activity()
  runtime.check()
  stop()
  response.resolve({ data: active(), error: null })
  await settle()
  assert.equal(state.ready.length + state.errors.length + state.expired.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(runtime.activities.size + runtime.checks.size + runtime.timers.size, 0)
})

test('cleanup cancels a touch queued behind an in-flight status request', async () => {
  const runtime = new Runtime()
  const current = server(runtime)
  const response = deferred()
  const rpc = current.client.rpc
  current.client.rpc = (...args) => {
    if (args[0] === 'inventory_session_status') {
      current.calls.push({ name: args[0], args, at: runtime.tick })
      return response.promise
    }
    return rpc(...args)
  }
  const { state, stop } = await start(runtime, current)
  runtime.check()
  runtime.activity()
  stop()
  response.resolve({ data: active(), error: null })
  await settle()
  assert.equal(state.ready.length, 1)
  assert.deepEqual(current.calls.map((call) => call.name), ['inventory_session_start', 'inventory_session_status'])
})

test('RPC serialization prevents an older status from overwriting a later touch deadline', async () => {
  const runtime = new Runtime()
  const current = server(runtime, 5_000)
  const response = deferred()
  const rpc = current.client.rpc
  let delayed = true
  let concurrent = 0
  let maximumConcurrent = 0
  current.client.rpc = (...args) => {
    concurrent += 1
    maximumConcurrent = Math.max(maximumConcurrent, concurrent)
    const operation = args[0] === 'inventory_session_status' && delayed
      ? (delayed = false, current.calls.push({ name: args[0], args, at: runtime.tick }), response.promise)
      : rpc(...args)
    return Promise.resolve(operation).finally(() => { concurrent -= 1 })
  }
  const { state, stop } = await start(runtime, current)
  runtime.check()
  runtime.activity()
  response.resolve({ data: active(epoch, epoch + 5_000), error: null })
  await settle()
  assert.equal(maximumConcurrent, 1)
  assert.deepEqual(current.calls.map((call) => call.name), ['inventory_session_start', 'inventory_session_status', 'inventory_session_touch'])
  assert.equal(state.ready.at(-1).expiresAt, epoch + windowMs)
  await runtime.advance(5_000)
  assert.equal(state.expired.length, 0)
  stop()
})

test('an active response delayed beyond its remaining lifetime is rechecked before exposing ready', async () => {
  const runtime = new Runtime()
  const response = deferred()
  const current = server(runtime, 5_000)
  const rpc = current.client.rpc
  current.client.rpc = (...args) => args[0] === 'inventory_session_start'
    ? (current.calls.push({ name: args[0], args, at: runtime.tick }), response.promise)
    : rpc(...args)
  const { state } = await start(runtime, current)
  runtime.elapse(6_000)
  response.resolve({ data: active(epoch, epoch + 5_000), error: null })
  await settle()
  assert.equal(state.ready.length, 0)
  assert.equal(state.checking.length, 1)
  assert.equal(state.expired.length, 1)
  assert.deepEqual(current.calls.map((call) => call.name), ['inventory_session_start', 'inventory_session_status'])
})

test('partial listener registration failure cleans up the already registered activity observer', async () => {
  const runtime = new Runtime()
  const current = server(runtime)
  runtime.listenCheck = () => { throw new Error('private listener failure') }
  const { state } = await start(runtime, current)
  assert.equal(state.errors.length, 1)
  assert.equal(state.errors[0].code, 'unavailable')
  assert.equal(runtime.activities.size, 0)
  assert.equal(current.calls.length, 0)
})

test('server time deltas remain authoritative despite a wildly different browser clock or clock rollback', async () => {
  const runtime = new Runtime()
  const current = server(runtime, 5_000)
  const { state } = await start(runtime, current)
  runtime.elapse(5_000, -5_000_000, 5_000)
  runtime.check()
  await settle()
  assert.equal(state.expired.length, 1)
})

test('browser adapter allows only trusted visible input while passive events remain status-only', async (t) => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const listeners = new Map()
  const timers = new Map()
  let time = 0
  let nextTimer = 1
  const add = (target, type, listener) => {
    const key = `${target}:${type}`
    const entries = listeners.get(key) ?? new Set()
    entries.add(listener)
    listeners.set(key, entries)
  }
  const remove = (target, type, listener) => listeners.get(`${target}:${type}`)?.delete(listener)
  const emit = (target, type, event = {}) => {
    for (const listener of [...(listeners.get(`${target}:${type}`) ?? [])]) listener(event)
  }
  globalThis.window = {
    addEventListener: (type, listener) => add('window', type, listener),
    removeEventListener: (type, listener) => remove('window', type, listener),
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id },
    clearTimeout: (id) => timers.delete(id),
  }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, listener) => add('document', type, listener),
    removeEventListener: (type, listener) => remove('document', type, listener),
  }
  t.mock.method(Date, 'now', () => epoch + time)
  t.mock.method(performance, 'now', () => time)
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  })
  const calls = []
  const client = { rpc: async (name) => { calls.push(name); return { data: active(epoch + time), error: null } } }
  const stop = watchInventorySession({ client, sessionId, onReady() {}, onExpired() {}, onError() {} })
  t.after(stop)
  await settle()
  assert.deepEqual([...listeners.keys()].sort(), [
    'window:pointerdown', 'window:pointermove', 'window:keydown', 'window:wheel', 'window:touchstart',
    'window:focus', 'window:pageshow', 'document:visibilitychange',
  ].sort())
  emit('window', 'pointermove', { isTrusted: false })
  globalThis.document.visibilityState = 'hidden'
  emit('window', 'keydown', { isTrusted: true })
  emit('document', 'visibilitychange')
  await settle()
  assert.deepEqual(calls, ['inventory_session_start', 'inventory_session_status'])
  globalThis.document.visibilityState = 'visible'
  emit('window', 'pointerdown', { isTrusted: true })
  await settle()
  assert.equal(calls.at(-1), 'inventory_session_touch')
  time += 31_000
  emit('window', 'focus')
  emit('window', 'pageshow')
  await settle()
  assert.equal(calls.filter((name) => name === 'inventory_session_touch').length, 1)
  stop()
  assert.equal(timers.size, 0)
  assert.ok([...listeners.values()].every((set) => set.size === 0))
})

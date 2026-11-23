import assert from 'node:assert/strict'
import test from 'node:test'
import { INACTIVITY_TIMEOUT_MS, watchSessionActivity } from '../src/lib/sessionActivity.ts'

const epoch = 1_800_000_000_000
const sessionKey = 'user-uuid:supabase-session-uuid'
const key = `device-inventory:activity:${sessionKey}`

class FakeRuntime {
  wall = epoch
  monotonic = 0
  tick = 0
  nextTimer = 1
  timers = new Map()
  activities = new Set()
  checks = new Set()
  storageListeners = new Set()
  writes = []
  readFails = false
  writeFails = false

  constructor(storage = new Map()) {
    this.storage = storage
  }

  wallNow = () => this.wall
  monotonicNow = () => this.monotonic
  read = (storageKey) => {
    if (this.readFails) throw new Error('storage blocked')
    return this.storage.get(storageKey) ?? null
  }
  write = (storageKey, value) => {
    if (this.writeFails) throw new Error('quota exceeded')
    this.storage.set(storageKey, value)
    this.writes.push({ key: storageKey, value })
  }
  listenActivity = (listener) => {
    this.activities.add(listener)
    return () => this.activities.delete(listener)
  }
  listenCheck = (listener) => {
    this.checks.add(listener)
    return () => this.checks.delete(listener)
  }
  listenStorage = (listener) => {
    this.storageListeners.add(listener)
    return () => this.storageListeners.delete(listener)
  }
  schedule = (callback, delay) => {
    const id = this.nextTimer++
    this.timers.set(id, { at: this.tick + delay, callback })
    return id
  }
  cancel = (id) => { this.timers.delete(id) }

  activity(trusted = true) {
    for (const listener of [...this.activities]) listener(trusted)
  }
  check() {
    for (const listener of [...this.checks]) listener()
  }
  storageEvent(storageKey, value) {
    if (storageKey === null) this.storage.clear()
    else if (value === null) this.storage.delete(storageKey)
    else this.storage.set(storageKey, value)
    for (const listener of [...this.storageListeners]) listener(storageKey, value)
  }

  elapseWithoutTimers(milliseconds, wallDelta = milliseconds, monotonicDelta = milliseconds) {
    this.tick += milliseconds
    this.wall += wallDelta
    this.monotonic += monotonicDelta
  }

  advance(milliseconds) {
    const target = this.tick + milliseconds
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!next) break
      const [id, timer] = next
      this.timers.delete(id)
      this.elapseWithoutTimers(Math.max(0, timer.at - this.tick))
      timer.callback()
    }
    this.elapseWithoutTimers(target - this.tick)
  }

  get listenerCount() {
    return this.activities.size + this.checks.size + this.storageListeners.size
  }
}

function start(runtime = new FakeRuntime(), id = sessionKey) {
  const state = { expired: 0 }
  const stop = watchSessionActivity(id, () => { state.expired += 1 }, runtime)
  return { runtime, state, stop }
}

test('expires exactly once after 30 minutes and removes all timers and listeners', () => {
  assert.equal(INACTIVITY_TIMEOUT_MS, 30 * 60 * 1000)
  const { runtime, state, stop } = start()

  runtime.advance(INACTIVITY_TIMEOUT_MS - 1)
  assert.equal(state.expired, 0)
  runtime.advance(1)
  assert.equal(state.expired, 1)
  assert.equal(runtime.listenerCount, 0)
  assert.equal(runtime.timers.size, 0)
  runtime.activity()
  runtime.check()
  runtime.advance(INACTIVITY_TIMEOUT_MS)
  stop()
  assert.equal(state.expired, 1)
})

test('synthetic activity and passive checks never extend the stored deadline', () => {
  const { runtime, state } = start()
  const initial = runtime.storage.get(key)
  runtime.advance(15 * 60 * 1000)
  runtime.activity(false)
  for (let event = 0; event < 20; event += 1) runtime.check()

  assert.equal(runtime.storage.get(key), initial)
  assert.equal(runtime.writes.length, 1)
  runtime.advance(15 * 60 * 1000)
  assert.equal(state.expired, 1)
})

test('trusted activity extends inactivity from the actual event time', () => {
  const { runtime, state } = start()
  runtime.advance(20 * 60 * 1000)
  runtime.activity()
  assert.equal(JSON.parse(runtime.storage.get(key)), epoch + 20 * 60 * 1000)

  runtime.advance(INACTIVITY_TIMEOUT_MS - 1)
  assert.equal(state.expired, 0)
  runtime.advance(1)
  assert.equal(state.expired, 1)
})

test('a late trusted event cannot revive an already-expired suspended session', () => {
  const { runtime, state } = start()
  runtime.elapseWithoutTimers(INACTIVITY_TIMEOUT_MS + 1)
  runtime.activity()

  assert.equal(state.expired, 1)
  assert.equal(JSON.parse(runtime.storage.get(key)), epoch)
  assert.equal(runtime.writes.length, 1)
})

test('reloads and StrictMode remounts preserve the original deadline', () => {
  const { runtime, state, stop } = start()
  stop()
  const remount = start(runtime)
  runtime.advance(20 * 60 * 1000)
  remount.stop()
  const reload = start(runtime)

  assert.equal(runtime.writes.length, 1, 'mounting alone does not record user activity')
  runtime.advance(10 * 60 * 1000 - 1)
  assert.equal(reload.state.expired, 0)
  runtime.advance(1)
  assert.equal(reload.state.expired, 1)
  assert.equal(state.expired, 0, 'the stopped controller cannot fire')
  assert.equal(remount.state.expired, 0)
})

test('pointer bursts persist the final real event with at most one write per second', () => {
  const { runtime, state, stop } = start()
  for (let event = 0; event < 99; event += 1) {
    runtime.advance(10)
    runtime.activity()
  }
  assert.equal(runtime.writes.length, 1, 'bursts do not write on each pointer event')
  runtime.advance(10)
  assert.equal(runtime.writes.length, 2)
  assert.equal(JSON.parse(runtime.storage.get(key)), epoch + 990, 'flush stores event time, not timer time')

  runtime.advance(INACTIVITY_TIMEOUT_MS - 11)
  assert.equal(state.expired, 0)
  runtime.advance(1)
  assert.equal(state.expired, 1, 'the final event is not discarded by throttling')
  stop()
})

test('cleanup flushes pending real activity and leaves a remount with one set of listeners', () => {
  const { runtime, stop } = start()
  runtime.advance(250)
  runtime.activity()
  stop()
  assert.equal(JSON.parse(runtime.storage.get(key)), epoch + 250)
  assert.equal(runtime.timers.size, 0)
  assert.equal(runtime.listenerCount, 0)

  const remount = start(runtime)
  assert.equal(runtime.listenerCount, 3)
  assert.equal(runtime.timers.size, 1)
  remount.stop()
  assert.equal(runtime.listenerCount, 0)
})

test('tabs of the same session share activity without manufacturing additional writes', () => {
  const storage = new Map()
  const first = start(new FakeRuntime(storage))
  const second = start(new FakeRuntime(storage))
  first.runtime.advance(INACTIVITY_TIMEOUT_MS - 1_000)
  second.runtime.advance(INACTIVITY_TIMEOUT_MS - 1_000)
  first.runtime.activity()
  second.runtime.storageEvent(key, storage.get(key))

  second.runtime.advance(INACTIVITY_TIMEOUT_MS - 1)
  assert.equal(second.state.expired, 0)
  assert.equal(second.runtime.writes.length, 0, 'receiving activity only reads the shared deadline')
  second.runtime.advance(1)
  assert.equal(second.state.expired, 1)
  first.stop()
})

test('unrelated sessions and storage events cannot extend the current session', () => {
  const { runtime, state } = start()
  runtime.advance(20 * 60 * 1000)
  runtime.storageEvent('device-inventory:activity:other-user:other-session', JSON.stringify(runtime.wall))
  runtime.advance(10 * 60 * 1000)

  assert.equal(state.expired, 1)
  assert.equal(JSON.parse(runtime.storage.get(key)), epoch)
  assert.equal(typeof JSON.parse(runtime.storage.get(key)), 'number', 'the persisted value contains only a timestamp')
})

test('periodic checks observe shared activity even if a storage event was missed', () => {
  const { runtime, state } = start()
  runtime.advance(INACTIVITY_TIMEOUT_MS - 1_000)
  runtime.storage.set(key, JSON.stringify(runtime.wall))
  runtime.advance(1_001)

  assert.equal(state.expired, 0, 'the old local deadline sees the newer shared record')
  runtime.advance(INACTIVITY_TIMEOUT_MS - 1_001)
  assert.equal(state.expired, 1)
})

test('a pending flush or cleanup never overwrites newer activity from another tab', () => {
  for (const cleanup of [false, true]) {
    const { runtime, stop } = start()
    runtime.advance(250)
    runtime.activity()
    runtime.advance(250)
    const shared = JSON.stringify(runtime.wall)
    runtime.storage.set(key, shared)

    if (cleanup) stop()
    else runtime.advance(500)

    assert.equal(runtime.storage.get(key), shared)
    assert.equal(runtime.writes.length, 1)
    stop()
  }
})

test('malformed, expired, and future persisted records fail closed without being overwritten', () => {
  for (const value of ['broken json', 'null', '"timestamp"', '-1', '1e999', JSON.stringify(epoch + 1), JSON.stringify(epoch - INACTIVITY_TIMEOUT_MS)]) {
    const storage = new Map([[key, value]])
    const { runtime, state, stop } = start(new FakeRuntime(storage))
    assert.equal(state.expired, 1, value)
    assert.equal(runtime.storage.get(key), value)
    assert.equal(runtime.writes.length, 0)
    assert.equal(runtime.listenerCount, 0)
    assert.equal(runtime.timers.size, 0)
    stop()
    assert.equal(state.expired, 1)
  }
})

test('removed, cleared, or future shared records expire a running controller', () => {
  for (const [eventKey, value] of [[key, null], [null, null], [key, JSON.stringify(epoch + 1)]]) {
    const { runtime, state } = start()
    runtime.storageEvent(eventKey, value)
    assert.equal(state.expired, 1)
    assert.equal(runtime.listenerCount, 0)
    assert.equal(runtime.timers.size, 0)
  }
})

test('blocked storage preserves an in-memory activity deadline without throwing', () => {
  for (const failure of ['readFails', 'writeFails']) {
    const runtime = new FakeRuntime()
    runtime[failure] = true
    const { state } = start(runtime)
    runtime.advance(20 * 60 * 1000)
    runtime.activity()
    runtime.advance(INACTIVITY_TIMEOUT_MS - 1)
    assert.equal(state.expired, 0, failure)
    runtime.advance(1)
    assert.equal(state.expired, 1, failure)
    assert.equal(runtime.listenerCount, 0)
  }
})

test('storage access failure during a running session does not reset its deadline', () => {
  const { runtime, state } = start()
  runtime.advance(INACTIVITY_TIMEOUT_MS - 1)
  runtime.readFails = true
  runtime.check()
  assert.equal(state.expired, 0)
  runtime.advance(1)
  assert.equal(state.expired, 1)
})

test('browser sleep is detected on a passive check even if the monotonic clock paused', () => {
  const { runtime, state } = start()
  runtime.elapseWithoutTimers(INACTIVITY_TIMEOUT_MS + 1, INACTIVITY_TIMEOUT_MS + 1, 0)
  runtime.check()
  assert.equal(state.expired, 1)
  assert.equal(runtime.writes.length, 1)
})

test('a clock rollback cannot prolong the monotonic inactivity period', () => {
  const { runtime, state } = start()
  runtime.advance(10 * 60 * 1000)
  runtime.elapseWithoutTimers(20 * 60 * 1000, -60 * 60 * 1000, 20 * 60 * 1000)
  runtime.check()
  assert.equal(state.expired, 1)
})

test('a forward clock change followed by rollback cannot freeze elapsed time', () => {
  const { runtime, state } = start()
  runtime.advance(60_000)
  runtime.elapseWithoutTimers(0, 15 * 60 * 1000, 0)
  runtime.check()
  runtime.elapseWithoutTimers(0, -15 * 60 * 1000, 0)
  runtime.check()
  runtime.advance(14 * 60 * 1000)
  assert.equal(state.expired, 1)
})

test('the browser adapter counts only trusted visible input and cleans up its event listeners', (t) => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const listeners = new Map()
  const timers = new Map()
  const storage = new Map()
  let wall = epoch
  let nextTimer = 1
  let expired = 0
  const add = (target, type, listener) => {
    const name = `${target}:${type}`
    const set = listeners.get(name) ?? new Set()
    set.add(listener)
    listeners.set(name, set)
  }
  const remove = (target, type, listener) => listeners.get(`${target}:${type}`)?.delete(listener)
  const emit = (target, type, event = {}) => {
    for (const listener of [...(listeners.get(`${target}:${type}`) ?? [])]) listener(event)
  }
  const localStorage = {
    getItem: (storageKey) => storage.get(storageKey) ?? null,
    setItem: (storageKey, value) => storage.set(storageKey, value),
  }
  globalThis.window = {
    localStorage,
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, listener) => add('window', type, listener),
    removeEventListener: (type, listener) => remove('window', type, listener),
  }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, listener) => add('document', type, listener),
    removeEventListener: (type, listener) => remove('document', type, listener),
  }
  t.mock.method(Date, 'now', () => wall)
  t.mock.method(performance, 'now', () => 0)
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  })
  const stop = watchSessionActivity(sessionKey, () => { expired += 1 })
  t.after(stop)

  assert.deepEqual([...listeners.keys()].sort(), [
    'document:visibilitychange', 'window:focus', 'window:keydown', 'window:pageshow',
    'window:pointerdown', 'window:pointermove', 'window:storage', 'window:touchstart', 'window:wheel',
  ].sort())
  wall += 2_000
  emit('window', 'pointermove', { isTrusted: false })
  emit('window', 'focus')
  emit('window', 'pageshow')
  emit('document', 'visibilitychange')
  assert.equal(JSON.parse(storage.get(key)), epoch)

  globalThis.document.visibilityState = 'hidden'
  emit('window', 'keydown', { isTrusted: true })
  assert.equal(JSON.parse(storage.get(key)), epoch)
  globalThis.document.visibilityState = 'visible'
  emit('window', 'pointermove', { isTrusted: true })
  assert.equal(JSON.parse(storage.get(key)), wall)
  assert.equal(expired, 0)

  stop()
  assert.equal(timers.size, 0)
  assert.ok([...listeners.values()].every((set) => set.size === 0))
})

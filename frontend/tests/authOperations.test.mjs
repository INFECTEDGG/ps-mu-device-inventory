import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flushScheduledOperations } from 'node:timers/promises'
import { AUTH_OPERATION_LOCK_NAME, createAuthOperations, isLogoutPending, runLogout, subscribeLogout, waitForLogout } from '../src/lib/authOperations.ts'
import { loginWithPassword, PasswordLoginError } from '../src/lib/passwordLogin.ts'

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function sharedOriginLock() {
  let tail = Promise.resolve()
  return {
    withExclusiveLock(operation) {
      const result = tail.then(operation)
      tail = result.catch(() => undefined)
      return result
    },
  }
}

test('a delayed logout finishes clearing the old session before a fresh sign-in starts', async () => {
  const response = deferred()
  const events = []
  let storedSession = 'old-session'
  const logout = runLogout(async () => {
    events.push('logout started')
    await response.promise
    storedSession = null
    events.push('old session cleared')
  })
  const login = loginWithPassword({ auth: { async signInWithPassword() {
    events.push('login started')
    storedSession = 'fresh-session'
    return { data: { session: {} }, error: null }
  } } }, 'test@example.invalid', 'password')

  await flushScheduledOperations()
  assert.equal(isLogoutPending(), true)
  assert.deepEqual(events, ['logout started'])
  response.resolve()
  await Promise.all([logout, login])
  assert.deepEqual(events, ['logout started', 'old session cleared', 'login started'])
  assert.equal(storedSession, 'fresh-session')
  assert.equal(isLogoutPending(), false)
})

test('failed logout also settles before the next sign-in and releases the gate', async () => {
  const response = deferred()
  let signIns = 0
  const logout = runLogout(async () => { await response.promise })
  const rejected = assert.rejects(logout, /network failure/)
  const login = loginWithPassword({ auth: { async signInWithPassword() {
    signIns += 1
    return { data: { session: {} }, error: null }
  } } }, 'test@example.invalid', 'password')

  await flushScheduledOperations()
  assert.equal(signIns, 0)
  response.reject(new Error('network failure'))
  await Promise.all([rejected, login])
  assert.equal(signIns, 1)
  assert.equal(isLogoutPending(), false)
})

test('simultaneous and reentrant logout requests share exactly one operation', async () => {
  const response = deferred()
  const statuses = []
  let operationCalls = 0
  let unexpectedCalls = 0
  let nested
  const unsubscribe = subscribeLogout(() => {
    statuses.push(isLogoutPending())
    if (isLogoutPending()) nested = runLogout(async () => { unexpectedCalls += 1 })
  })
  try {
    const first = runLogout(async () => { operationCalls += 1; await response.promise })
    const second = runLogout(async () => { unexpectedCalls += 1 })
    assert.equal(first, second)
    assert.equal(first, nested)
    await flushScheduledOperations()
    assert.equal(operationCalls, 1)
    assert.equal(unexpectedCalls, 0)
    response.resolve()
    await Promise.all([first, second, nested])
    assert.deepEqual(statuses, [true, false])
  } finally {
    unsubscribe()
  }
})

test('waiting includes a follow-up logout started by a completion observer', async () => {
  const firstResponse = deferred()
  const nextResponse = deferred()
  let nextOperation
  let startedNext = false
  const unsubscribe = subscribeLogout(() => {
    if (!isLogoutPending() && !startedNext) {
      startedNext = true
      nextOperation = runLogout(async () => { await nextResponse.promise })
    }
  })
  let done = false
  try {
    const first = runLogout(async () => { await firstResponse.promise })
    const waiter = waitForLogout().then(() => { done = true })
    firstResponse.resolve()
    await first
    assert.equal(startedNext, true)
    assert.equal(done, false)
    assert.equal(isLogoutPending(), true)
    nextResponse.resolve()
    await Promise.all([nextOperation, waiter])
    assert.equal(done, true)
  } finally {
    unsubscribe()
  }
})

test('invalid login input is rejected without requests or waiting for a logout', async () => {
  const response = deferred()
  let calls = 0
  const logout = runLogout(async () => { await response.promise })
  const client = { auth: { async signInWithPassword() { calls += 1 } } }
  try {
    await assert.rejects(loginWithPassword(client, '', 'password'), PasswordLoginError)
    await assert.rejects(loginWithPassword(client, 'test@example.invalid', ''), PasswordLoginError)
    await assert.rejects(loginWithPassword(null, 'test@example.invalid', 'password'), PasswordLoginError)
    assert.equal(calls, 0)
    assert.equal(isLogoutPending(), true)
  } finally {
    response.resolve()
    await logout
  }
})

test('synchronously thrown operations still release the gate and notify surviving observers', async () => {
  const statuses = []
  const broken = subscribeLogout(() => { throw new Error('broken observer') })
  const surviving = subscribeLogout(() => { statuses.push(isLogoutPending()) })
  try {
    await assert.rejects(runLogout(() => { throw new Error('operation failed') }), /operation failed/)
    assert.equal(isLogoutPending(), false)
    assert.deepEqual(statuses, [true, false])
  } finally {
    broken()
    surviving()
  }
})

test('unsubscribed observers receive no further status notifications', async () => {
  let notifications = 0
  const unsubscribe = subscribeLogout(() => { notifications += 1 })
  unsubscribe()
  await runLogout(async () => undefined)
  assert.equal(notifications, 0)
})

test('observer resubscription cannot repeat the same notification indefinitely', async () => {
  let notifications = 0
  let unsubscribe
  const observer = () => {
    notifications += 1
    // Ein fehlerhafter Lock darf den Test nicht blockieren.
    if (notifications > 2) throw new Error('observer was revisited during one notification')
    unsubscribe()
    unsubscribe = subscribeLogout(observer)
  }
  unsubscribe = subscribeLogout(observer)
  try {
    const result = runLogout(async () => undefined)
    assert.equal(notifications, 1)
    await result
    assert.equal(notifications, 2)
  } finally {
    unsubscribe()
  }
})

test('two tab coordinators serialize slow idle logout before a fresh sign-in', async () => {
  const lock = sharedOriginLock()
  const tabA = createAuthOperations(lock)
  const tabB = createAuthOperations(lock)
  const response = deferred()
  let currentSession = 'old-session'
  let loginCalls = 0
  const oldLogout = tabB.runLogoutIfCurrent('old-session', async () => currentSession, async () => {
    await response.promise
    currentSession = null
  })
  await flushScheduledOperations()
  const newLogin = tabA.runLogin(async () => {
    loginCalls += 1
    currentSession = 'new-session'
  })
  await flushScheduledOperations()
  assert.equal(loginCalls, 0)
  response.resolve()
  await Promise.all([oldLogout, newLogin])
  assert.equal(loginCalls, 1)
  assert.equal(currentSession, 'new-session')
})

test('a queued stale idle logout cannot remove another tab\'s new session', async () => {
  const lock = sharedOriginLock()
  const tabA = createAuthOperations(lock)
  const tabB = createAuthOperations(lock)
  const response = deferred()
  let currentSession = 'old-session'
  let logoutCalls = 0
  const login = tabA.runLogin(async () => {
    await response.promise
    currentSession = 'new-session'
  })
  await flushScheduledOperations()
  const staleIdleLogout = tabB.runLogoutIfCurrent('old-session', async () => currentSession, async () => {
    logoutCalls += 1
    currentSession = null
  })
  response.resolve()
  await Promise.all([login, staleIdleLogout])
  assert.equal(logoutCalls, 0)
  assert.equal(currentSession, 'new-session')
})

test('two tabs expiring the same old session perform only its first logout', async () => {
  const lock = sharedOriginLock()
  const tabA = createAuthOperations(lock)
  const tabB = createAuthOperations(lock)
  let currentSession = 'old-session'
  let logoutCalls = 0
  const getCurrent = async () => currentSession
  const signOut = async () => { logoutCalls += 1; currentSession = null }
  await Promise.all([
    tabA.runLogoutIfCurrent('old-session', getCurrent, signOut),
    tabB.runLogoutIfCurrent('old-session', getCurrent, signOut),
  ])
  assert.equal(logoutCalls, 1)
  assert.equal(tabA.isLogoutPending(), false)
  assert.equal(tabB.isLogoutPending(), false)
})

test('manual logout is not deduplicated into an obsolete idle logout', async () => {
  const tab = createAuthOperations(sharedOriginLock())
  let currentSession = 'new-session'
  let idleCalls = 0
  let manualCalls = 0
  const idle = tab.runLogoutIfCurrent('old-session', async () => currentSession, async () => { idleCalls += 1 })
  const manual = tab.runLogout(async () => { manualCalls += 1; currentSession = null })
  assert.notEqual(idle, manual)
  await Promise.all([idle, manual])
  assert.equal(idleCalls, 0)
  assert.equal(manualCalls, 1)
  assert.equal(currentSession, null)
})

test('lock acquisition failure does not run the operation unlocked and releases local status', async () => {
  let calls = 0
  const tab = createAuthOperations({ async withExclusiveLock() { throw new Error('lock unavailable') } })
  await assert.rejects(tab.runLogout(async () => { calls += 1 }), /lock unavailable/)
  assert.equal(calls, 0)
  assert.equal(tab.isLogoutPending(), false)
  await assert.rejects(tab.runLogin(async () => { calls += 1 }), /lock unavailable/)
  assert.equal(calls, 0)
})

test('browser operations request the dedicated origin-wide exclusive Web Lock', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const calls = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { async request(name, options, operation) {
      calls.push({ name, options })
      return operation()
    } } },
  })
  try {
    const tab = createAuthOperations()
    assert.equal(await tab.runLogin(async () => 'signed in'), 'signed in')
    await tab.runLogout(async () => undefined)
    assert.deepEqual(calls, [
      { name: AUTH_OPERATION_LOCK_NAME, options: { mode: 'exclusive' } },
      { name: AUTH_OPERATION_LOCK_NAME, options: { mode: 'exclusive' } },
    ])
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
  }
})

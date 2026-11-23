import assert from 'node:assert/strict'
import test from 'node:test'
import { getSessionActivityKey } from '../src/lib/sessionKey.ts'
import { hasPermission } from '../src/config/permissions.ts'

const sessionId = '11111111-2222-4333-8444-555555555555'
function session(claims) {
  return { access_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`, user: { id: 'user-uuid' } }
}

test('token refresh retains the same activity key while a fresh sign-in has its own deadline', () => {
  const before = getSessionActivityKey(session({ session_id: sessionId, iat: 100 }))
  const after = getSessionActivityKey(session({ session_id: sessionId, iat: 500 }))
  assert.equal(before, `user-uuid:${sessionId}`)
  assert.equal(after, before)
  assert.notEqual(getSessionActivityKey(session({ session_id: '11111111-2222-4333-8444-666666666666' })), before)
  assert.ok(!before.includes('signature'))
})

test('invalid session identities cannot create a new activity deadline', () => {
  for (const access_token of ['', 'invalid', 'a.@@@.b', 'a.bnVsbA.b']) {
    assert.equal(getSessionActivityKey({ access_token, user: { id: 'uuid' } }), null)
  }
  for (const claims of [{}, { session_id: 'admin' }, { session_id: 12 }]) {
    assert.equal(getSessionActivityKey(session(claims)), null)
  }
})

test('employee and manager cannot open user administration, and missing roles grant nothing', () => {
  assert.equal(hasPermission('employee', 'users:manage'), false)
  assert.equal(hasPermission('device_manager', 'users:manage'), false)
  assert.equal(hasPermission('admin', 'users:manage'), true)
  assert.equal(hasPermission(null, 'devices:view_own'), false)
  assert.equal(hasPermission(undefined, 'dashboard:view'), false)
  assert.equal(hasPermission('employee', 'devices:view_own'), true)
  assert.equal(hasPermission('employee', 'devices:view_all'), false)
})

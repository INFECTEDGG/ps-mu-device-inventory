import assert from 'node:assert/strict'
import test from 'node:test'
import { loadUserRole, UserRoleError } from '../src/services/loadUserRole.ts'

function lookupClient(profile, role) {
  const calls = []
  return {
    calls,
    client: {
      async getProfile(userId) {
        calls.push(['profile', userId])
        return profile
      },
      async getRole(roleId) {
        calls.push(['role', roleId])
        return role
      },
    },
  }
}

test('roles come from the profile foreign key and roles.name, never from metadata or a fixed ID', async () => {
  for (const name of ['employee', 'device_manager', 'admin']) {
    const { client, calls } = lookupClient({ data: { role_id: 47 }, error: null }, { data: { name }, error: null })
    assert.equal(await loadUserRole('user-uuid', client), name)
    assert.deepEqual(calls, [
      ['profile', 'user-uuid'],
      ['role', 47],
    ])
  }
})

test('a missing profile fails closed without granting employee or admin', async () => {
  const { client, calls } = lookupClient({ data: null, error: null })
  await assert.rejects(loadUserRole('uuid', client), (error) => error instanceof UserRoleError && error.code === 'profile_missing')
  assert.equal(calls.length, 1)
})

test('null, invalid and unsafe role references fail before a role query', async () => {
  for (const role_id of [null, undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'admin', '', '3 OR true']) {
    const { client, calls } = lookupClient({ data: { role_id }, error: null })
    await assert.rejects(loadUserRole('uuid', client), (error) => error instanceof UserRoleError && error.code === 'role_missing')
    assert.equal(calls.length, 1)
  }
})

test('bigint references represented as strings are supported', async () => {
  const { client } = lookupClient({ data: { role_id: '9007199254740993' }, error: null }, { data: { name: 'employee' }, error: null })
  assert.equal(await loadUserRole('uuid', client), 'employee')
})

test('unknown or missing role names are rejected', async () => {
  for (const data of [null, { name: 'superuser' }, { name: null }, { name: 'ADMIN' }]) {
    const { client } = lookupClient({ data: { role_id: 3 }, error: null }, { data, error: null })
    await assert.rejects(loadUserRole('uuid', client), (error) => error instanceof UserRoleError && error.code === 'role_missing')
  }
})

test('database errors do not leak details or grant a role even if a row is returned', async () => {
  for (const failingTable of ['profiles', 'roles']) {
    const { client } = lookupClient(
      { data: { role_id: 1 }, error: failingTable === 'profiles' ? { message: 'private-table-policy-secret' } : null },
      { data: { name: 'admin' }, error: failingTable === 'roles' ? { message: 'private-table-policy-secret' } : null },
    )
    await assert.rejects(loadUserRole('uuid', client), (error) => {
      assert.ok(error instanceof UserRoleError)
      assert.equal(error.code, 'unavailable')
      assert.ok(!error.message.includes('private-table-policy-secret'))
      return true
    })
  }
})

test('network failures and missing configuration become safe errors', async () => {
  const client = { getProfile() { throw new Error('private connection details') } }
  for (const [id, currentClient] of [['uuid', null], ['', client], ['uuid', client]]) {
    await assert.rejects(loadUserRole(id, currentClient), (error) => error instanceof UserRoleError && error.code === 'unavailable' && !error.message.includes('private'))
  }
})

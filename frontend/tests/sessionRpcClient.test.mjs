import assert from 'node:assert/strict'
import test from 'node:test'
import { createBoundSessionClient } from '../src/lib/sessionRpcClient.ts'
import { ServerSessionError } from '../src/lib/serverSession.ts'

const oldId = '11111111-2222-4333-8444-555555555555'
const newId = '11111111-2222-4333-8444-666666666666'
function session(id, sequence = 1) {
  return { user: { id: 'user-uuid' }, access_token: `header.${Buffer.from(JSON.stringify({ session_id: id, iat: sequence })).toString('base64url')}.signature` }
}

test('an old controller sends no RPC after the SDK has switched to a different session', async () => {
  let calls = 0
  const client = createBoundSessionClient({
    getSession: async () => ({ session: session(newId), error: null }),
    rpc: async () => { calls += 1; return { data: null, error: null } },
  }, oldId)
  await assert.rejects(client.rpc('inventory_session_touch'), ServerSessionError)
  assert.equal(calls, 0)
})

test('RPC headers remain bound to the checked session even when the SDK changes before transmission', async () => {
  const checked = session(oldId)
  let current = checked
  const client = createBoundSessionClient({
    getSession: async () => {
      const result = { session: current, error: null }
      current = session(newId)
      return result
    },
    rpc: async (name, authorization) => {
      assert.equal(name, 'inventory_session_touch')
      assert.equal(authorization, `Bearer ${checked.access_token}`)
      assert.notEqual(authorization, `Bearer ${current.access_token}`)
      return { data: { active: true }, error: null }
    },
  }, oldId)
  assert.deepEqual(await client.rpc('inventory_session_touch'), { data: { active: true }, error: null })
})

test('refreshing a token within the same session uses its newest token without changing session identity', async () => {
  let sequence = 1
  const headers = []
  const client = createBoundSessionClient({
    getSession: async () => ({ session: session(oldId, sequence++), error: null }),
    rpc: async (_name, authorization) => { headers.push(authorization); return { data: null, error: null } },
  }, oldId)
  await client.rpc('inventory_session_status')
  await client.rpc('inventory_session_status')
  assert.notEqual(headers[0], headers[1])
})

test('missing sessions, SDK failures and transport errors become safe errors', async () => {
  for (const getSession of [
    async () => ({ session: null, error: null }),
    async () => ({ session: session(oldId), error: new Error('private SDK details') }),
    async () => { throw new Error('private transport details') },
    async () => ({ session: session(oldId), error: null }),
  ]) {
    const client = createBoundSessionClient({ getSession, rpc: async () => { throw new Error('private RPC details') } }, oldId)
    await assert.rejects(client.rpc('inventory_session_end'), (error) => error instanceof ServerSessionError && !error.message.includes('private'))
  }
})

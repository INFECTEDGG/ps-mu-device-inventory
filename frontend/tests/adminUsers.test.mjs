import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminHandler } from '../../supabase/functions/admin-users/handler.ts'
import { parseCommand } from '../../supabase/functions/admin-users/contracts.ts'

const id = '00000000-0000-4000-8000-000000000002'
const input = {
  action: 'create',
  first_name: ' Kim ',
  last_name: 'Test',
  email: 'KIM@example.com',
  password: 'a-long-test-password',
}
function fixture(overrides = {}) {
  const calls = []
  const deps = {
    async authenticate() {
      return true
    },
    async rpc(token, name, args) {
      calls.push({ token, name, args })
      return { data: true, error: null }
    },
    async create(data) {
      calls.push({ create: data })
      return { id }
    },
    async ban(target) {
      calls.push({ ban: target })
      return true
    },
    ...overrides,
  }
  const handle = createAdminHandler(deps, ['http://localhost:5173'])
  return {
    calls,
    send: (body, headers = {}) =>
      handle(
        new Request('https://example.invalid/admin-users', {
          method: 'POST',
          headers: { Authorization: 'Bearer signed-token', ...headers },
          body: JSON.stringify(body),
        }),
      ),
  }
}

test('normalises names and email, but never trims a password', () => {
  const password = '  a-long-password  '
  assert.deepEqual(parseCommand({ ...input, password }), {
    ...input,
    first_name: 'Kim',
    email: 'kim@example.com',
    password,
  })
})
test('rejects role injection, invalid IDs and weak passwords', () => {
  for (const value of [
    { ...input, role_id: 1 },
    { ...input, password: 'short' },
    { action: 'deactivate', id: 'x' },
    { ...input, first_name: ' ' },
  ]) {
    assert.throws(() => parseCommand(value))
  }
})
test('anonymous and invalid JWTs cannot reach privileged operations', async () => {
  const { send, calls } = fixture({
    async authenticate() {
      return false
    },
  })
  assert.equal((await send(input)).status, 401)
  assert.equal(calls.length, 0)
})
test('non-admin, disabled and expired callers are rejected by the DB check', async () => {
  for (const reason of ['employee', 'device_manager', 'disabled', 'expired']) {
    let creates = 0
    const { send } = fixture({
      async rpc() {
        return { data: null, error: { code: '42501', message: reason } }
      },
      async create() {
        creates++
        return { id }
      },
    })
    assert.equal((await send(input)).status, 403)
    assert.equal(creates, 0)
  }
})
test('account creation checks atomic profile creation before using the Auth Admin API', async () => {
  const { send, calls } = fixture()
  const response = await send(input)
  assert.equal(response.status, 201)
  assert.deepEqual(
    calls.slice(0, 2).map((call) => call.name),
    ['inventory_admin_check', 'inventory_admin_creation_ready'],
  )
  const text = await response.text()
  assert.equal(text.includes(input.password), false)
  assert.equal(text.includes('password'), false)
})
test('missing profile trigger prevents Auth creation', async () => {
  let creates = 0
  const { send } = fixture({
    async rpc(_token, name) {
      return {
        data: true,
        error:
          name === 'inventory_admin_creation_ready' ? { code: '55000' } : null,
      }
    },
    async create() {
      creates++
      return { id }
    },
  })
  assert.equal((await send(input)).status, 503)
  assert.equal(creates, 0)
})
test('deactivation commits access denial before the Auth ban, failures remain retryable', async () => {
  const { send, calls } = fixture({
    async ban() {
      return false
    },
  })
  const response = await send({ action: 'deactivate', id })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'ban_pending')
  assert.equal(calls[1].name, 'inventory_admin_disable_user')
  assert.equal(calls[1].args.target_id, id)
})
test('does not ban a target when DB authorisation/self-deactivation check fails', async () => {
  let bans = 0
  const { send } = fixture({
    async rpc(_token, name) {
      return {
        data: true,
        error:
          name === 'inventory_admin_disable_user' ? { code: '22023' } : null,
      }
    },
    async ban() {
      bans++
      return true
    },
  })
  assert.equal((await send({ action: 'deactivate', id })).status, 400)
  assert.equal(bans, 0)
})
test('a thrown Auth transport failure is also reported as pending, without undoing the access denial', async () => {
  const { send, calls } = fixture({
    async ban() {
      throw new Error('network unavailable')
    },
  })
  const response = await send({ action: 'deactivate', id })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'ban_pending')
  assert.equal(calls[1].name, 'inventory_admin_disable_user')
})
test('rejects unknown browser origins and hides internal error details', async () => {
  const { send } = fixture({
    async authenticate() {
      throw new Error('secret internal credentials')
    },
  })
  assert.equal(
    (await send(input, { Origin: 'https://attacker.invalid' })).status,
    403,
  )
  const text = await (await send(input)).text()
  assert.equal(text.includes('credentials'), false)
})

test('only explicit role assignment actions accepted; never super_admin', () => {
  assert.deepEqual(parseCommand({action:'assign_role',id,role:'admin'}), {action:'assign_role',id,role:'admin'})
  assert.throws(() => parseCommand({action:'assign_role',id,role:'super_admin'}))
  assert.throws(() => parseCommand({action:'assign_role',id,role:'admin',force:true}))
  assert.throws(() => parseCommand({action:'permission_update',role:'super_admin',permissions:[]}))
  assert.throws(() => parseCommand({action:'permission_update',role:'admin',permissions:'users:manage'}))
})
test('role change uses only caller-authorised RPC, not direct profile writes', async () => {
  const {send,calls} = fixture()
  assert.equal((await send({action:'assign_role',id,role:'device_manager'})).status,200)
  assert.deepEqual(calls.map(c=>c.name),['inventory_admin_check','inventory_admin_assign_role'])
  assert.deepEqual(calls[1].args,{target_id:id,target_role:'device_manager'})
})
test('admin promotion fails when DB denies it', async () => {
  const {send} = fixture({async rpc(_token,name) {
    return {data:true,error:name==='inventory_admin_assign_role'?{code:'42501'}:null}
  }})
  const resp = await send({action:'assign_role',id,role:'admin'})
  assert.equal(resp.status,403)
  assert.equal((await resp.json()).code,'forbidden')
})
test('permission changes are routed to SuperAdmin-only RPC', async () => {
  const {send,calls} = fixture()
  assert.equal((await send({action:'permission_update',role:'employee',permissions:['dashboard:view']})).status,200)
  assert.equal(calls[1].name,'inventory_superadmin_update_permissions')
  assert.deepEqual(calls[1].args,{target_role:'employee',selected_permissions:['dashboard:view']})
})

test('list defaults to active, supports disabled view and rejects unsupported status', async () => {
  const expected = {action:'list',page:0,search:'Kim',status:'active'}
  assert.deepEqual(parseCommand({action:'list',page:0,search:'  Kim  '}), expected)
  assert.deepEqual(parseCommand({action:'list',page:0,search:'  Kim  ',status:'active'}), expected)
  assert.deepEqual(parseCommand({action:'list',page:0,search:'',status:'disabled'}),
    {action:'list',page:0,search:'',status:'disabled'})
  assert.throws(() => parseCommand({action:'list',page:0,search:'',status:'all'}))
  assert.throws(() => parseCommand({action:'list',page:0,search:'',status:true}))
  assert.throws(() => parseCommand({action:'list',page:0,search:'',status:'disabled',admin:true}))
})

test('disabled-user list uses the secured DB function with explicit view argument', async () => {
  const {send,calls} = fixture({async rpc(token,name,args) {
    calls.push({token,name,args})
    return {data:{users:[],total:0},error:null}
  }})
  const resp = await send({action:'list',page:1,search:' Jane ',status:'disabled'})
  assert.equal(resp.status,200)
  assert.deepEqual(calls.map(call=>call.name),['inventory_admin_check','inventory_admin_list_users'])
  assert.deepEqual(calls[1].args,{page_number:1,search_text:'Jane',list_status:'disabled'})
})

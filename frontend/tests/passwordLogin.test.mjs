import assert from 'node:assert/strict'
import test from 'node:test'
import { loginWithPassword, PasswordLoginError } from '../src/lib/passwordLogin.ts'

function fakeClient(result = { data: { session: { access_token: 'fake-token' } }, error: null }) {
  const calls = []
  return {
    calls,
    client: {
      auth: {
        signInWithPassword: async (credentials) => {
          calls.push(credentials)
          return result
        },
      },
    },
  }
}

async function expectFriendlyRejection(action, privateDetails = []) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof PasswordLoginError, 'failures must use the public login error type')
    assert.ok(error.message.trim().length > 0, 'the error must contain a user-facing explanation')
    for (const detail of privateDetails) {
      assert.ok(!error.message.includes(detail), `the error must not expose ${detail}`)
    }
    return true
  })
}

test('successful login trims the email while preserving every password character', async () => {
  const { client, calls } = fakeClient()
  const password = '  Secret !\twith spaces  '

  const result = await loginWithPassword(client, ' \tuser@example.org\n', password)

  assert.equal(result, undefined)
  assert.deepEqual(calls, [{ email: 'user@example.org', password }])
})

test('empty credential fields are rejected before an authentication request is sent', async () => {
  const { client, calls } = fakeClient()
  for (const [email, password] of [
    ['', 'password'],
    [' \t\n', 'password'],
    ['user@example.org', ''],
    ['', ''],
  ]) {
    await expectFriendlyRejection(() => loginWithPassword(client, email, password))
  }

  assert.equal(calls.length, 0)
})

test('an unavailable Supabase client produces a friendly login error', async () => {
  await expectFriendlyRejection(
    () => loginWithPassword(null, 'user@example.org', 'password'),
    ['VITE_', 'supabaseUrl', 'TypeError'],
  )
})

test('invalid credentials do not expose the authentication service error', async () => {
  const privateMessage = 'INTERNAL AUTH SERVICE: invalid credentials at private-host'
  const { client, calls } = fakeClient({
    data: { session: null },
    error: { message: privateMessage, code: 'private_auth_code' },
  })

  await expectFriendlyRejection(
    () => loginWithPassword(client, 'user@example.org', 'password'),
    [privateMessage, 'private_auth_code', 'private-host'],
  )
  assert.equal(calls.length, 1)
})

test('a response without a usable session is rejected even when error is null', async () => {
  for (const data of [null, { session: null }, { session: undefined }]) {
    const { client, calls } = fakeClient({ data, error: null })

    await expectFriendlyRejection(() => loginWithPassword(client, 'user@example.org', 'password'))
    assert.equal(calls.length, 1)
  }
})

test('an authentication error takes precedence over a session in the same response', async () => {
  const privateMessage = 'private mixed-response failure'
  const { client } = fakeClient({
    data: { session: { access_token: 'unusable-token' } },
    error: new Error(privateMessage),
  })

  await expectFriendlyRejection(
    () => loginWithPassword(client, 'user@example.org', 'password'),
    [privateMessage, 'unusable-token'],
  )
})

test('thrown transport failures become friendly errors without exposing connection details', async () => {
  const privateMessage = 'ECONNRESET https://private-auth.example.org?api_key=private-key'
  let requests = 0
  const client = {
    auth: {
      signInWithPassword: async () => {
        requests += 1
        throw new Error(privateMessage)
      },
    },
  }

  await expectFriendlyRejection(
    () => loginWithPassword(client, 'user@example.org', 'password'),
    [privateMessage, 'ECONNRESET', 'private-key'],
  )
  assert.equal(requests, 1)
})

test('non-Error service rejections are normalized to the public login error type', async () => {
  const client = {
    auth: {
      signInWithPassword: async () => { throw { message: 'private payload', status: 503 } },
    },
  }

  await expectFriendlyRejection(
    () => loginWithPassword(client, 'user@example.org', 'password'),
    ['private payload', '[object Object]'],
  )
})

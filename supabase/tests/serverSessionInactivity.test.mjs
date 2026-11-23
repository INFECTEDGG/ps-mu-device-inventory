import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  startInventorySession, getInventorySession, touchInventorySession, endInventorySession,
} from '../../frontend/src/lib/serverSession.ts'

const migration = readFileSync(new URL('../migrations/20261026120000_server_session_inactivity.sql', import.meta.url), 'utf8')
const ownReadMigration = readFileSync(new URL('../migrations/20261026080000_auth_profile_read_policies.sql', import.meta.url), 'utf8')
const alice = '00000000-0000-4000-8000-000000000021'
const bob = '00000000-0000-4000-8000-000000000022'
const charlie = '00000000-0000-4000-8000-000000000023'
const aliceSession = '10000000-0000-4000-8000-000000000021'
const bobSession = '10000000-0000-4000-8000-000000000022'
const nextSession = '10000000-0000-4000-8000-000000000023'
const tables = ['profiles', 'roles', 'devices', 'assignments', 'device_status_history', 'audit_logs']
let template

before(async () => {
  template = new PGlite()
  await template.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb)
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt()->>'sub','')::uuid
    $$;
    create table auth.users(id uuid primary key);
    create table auth.sessions(
      id uuid primary key, user_id uuid not null references auth.users(id),
      created_at timestamptz not null default clock_timestamp(), not_after timestamptz
    );
    insert into auth.users values('${alice}'),('${bob}'),('${charlie}');
    insert into auth.sessions(id,user_id) values('${aliceSession}','${alice}'),('${bobSession}','${bob}'),('${nextSession}','${alice}');
    create table public.roles(id bigint primary key,name text not null unique);
    insert into public.roles values(1,'admin'),(3,'employee');
    create table public.profiles(id uuid primary key references auth.users(id),role_id bigint references public.roles(id));
    insert into public.profiles values('${alice}',3),('${bob}',1);
  `)
  for (const table of tables.slice(2)) {
    await template.exec(`create table public.${table}(id integer primary key,label text); insert into public.${table} values(1,'existing');`)
  }
  for (const table of tables) {
    await template.exec(`
      alter table public.${table} enable row level security;
      grant select,insert,update,delete on public.${table} to anon,authenticated;
      create policy team_permissive on public.${table} for all to anon,authenticated using(true) with check(true);
    `)
  }
  await template.exec('grant usage on schema public to anon,authenticated')
})

after(async () => template?.close())

async function dbFor(t, install = true) {
  const db = await template.clone()
  t.after(() => db.close())
  // Test-Anmeldungen auch bei langsameren Testläufen frisch halten.
  await db.exec('update auth.sessions set created_at=clock_timestamp()')
  if (install) await db.exec(migration)
  return db
}

async function asCaller(db, operation, {
  user = alice, sid = aliceSession, role = 'authenticated', claims = {},
} = {}) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:user,session_id:sid,role,...claims})])
    await tx.exec(`set local role ${role}`)
    return operation(tx)
  })
}

async function rpc(db, name, caller) {
  return asCaller(db, async tx => (await tx.query(`select public.inventory_session_${name}() as result`)).rows[0].result, caller)
}

async function stored(db, sid = aliceSession) {
  return (await db.query('select session_id,user_id,last_active_at,revoked_at from inventory_private.sessions where session_id=$1',[sid])).rows[0]
}

function assertActive(result, sid = aliceSession, user = alice) {
  assert.equal(result.active, true)
  assert.equal(result.reason, 'active')
  assert.equal(result.sessionId, sid)
  assert.equal(result.userId, user)
  assert.ok(Number.isSafeInteger(result.serverNow))
  assert.ok(Number.isSafeInteger(result.expiresAt))
  assert.ok(result.expiresAt > result.serverNow)
  assert.ok(result.expiresAt - result.serverNow <= 1_800_000)
}

async function expire(db, sid = aliceSession) {
  await db.query("update inventory_private.sessions set last_active_at=clock_timestamp()-interval '30 minutes' where session_id=$1",[sid])
}

test('fresh actual Auth sessions start with server-owned timestamps and a bounded response', async t => {
  const db = await dbFor(t)
  assert.equal((await db.query('select count(*)::int n from inventory_private.sessions')).rows[0].n,0)
  assertActive(await rpc(db,'start'))
  const row = await stored(db)
  assert.equal(row.user_id,alice)
  assert.equal(row.revoked_at,null)
})

test('restoration/status/token refresh and repeated start do not manufacture activity', async t => {
  const db = await dbFor(t)
  const first = await rpc(db,'start')
  const before = await stored(db)
  for (const name of ['status','start','status']) {
    const answer = await rpc(db,name,{claims:{iat:99_999_999_999,exp:100_000_000_000}})
    assertActive(answer)
    assert.equal(answer.expiresAt,first.expiresAt)
  }
  await asCaller(db, tx => tx.query('select * from public.devices'))
  assert.equal((await stored(db)).last_active_at.getTime(),before.last_active_at.getTime())
})

test('only touch of an active session renews activity using the database clock', async t => {
  const db = await dbFor(t)
  await rpc(db,'start')
  await db.query("update inventory_private.sessions set last_active_at=clock_timestamp()-interval '29 minutes' where session_id=$1",[aliceSession])
  const before = await stored(db)
  const answer = await rpc(db,'touch')
  assertActive(answer)
  assert.ok(answer.expiresAt-answer.serverNow>1_790_000)
  assert.ok((await stored(db)).last_active_at.getTime()>before.last_active_at.getTime())
})

test('exactly 30 minutes is expired and no RPC or refreshed JWT can resurrect that record', async t => {
  const db = await dbFor(t)
  await rpc(db,'start')
  await expire(db)
  const before = await stored(db)
  for (const name of ['status','touch','start','status']) {
    const answer = await rpc(db,name,{claims:{iat:99_999_999_999}})
    assert.equal(answer.active,false)
    assert.equal(answer.reason,'expired')
  }
  assert.equal((await stored(db)).last_active_at.getTime(),before.last_active_at.getTime())
})

test('missing activity records cannot be initialized by an old login or by touch', async t => {
  const db = await dbFor(t)
  assert.equal((await rpc(db,'touch')).reason,'missing')
  assert.equal(await stored(db),undefined)
  await db.query("update auth.sessions set created_at=clock_timestamp()-interval '61 seconds' where id=$1",[aliceSession])
  for (const name of ['start','status','touch']) assert.equal((await rpc(db,name)).active,false)
  assert.equal(await stored(db),undefined)
})

test('invalid, missing, unknown and other-user session claims never start an activity record', async t => {
  const db = await dbFor(t)
  for (const caller of [
    {sid:null}, {sid:'not-a-uuid'}, {sid:'90000000-0000-4000-8000-000000000099'},
    {sid:bobSession}, {user:null}, {user:'invalid-subject'},
  ]) {
    for (const name of ['start','status','touch','end']) {
      const result = await rpc(db,name,caller)
      assert.equal(result.active,false)
      assert.equal(result.reason,'invalid')
    }
  }
  assert.equal((await db.query('select count(*)::int n from inventory_private.sessions')).rows[0].n,0)
})

test('logout produces an irreversible own-session tombstone even before start', async t => {
  const db = await dbFor(t)
  assert.equal((await rpc(db,'end')).reason,'revoked')
  const before = await stored(db)
  assert.ok(before.revoked_at)
  for (const name of ['start','touch','status','end']) assert.equal((await rpc(db,name)).reason,'revoked')
  assert.equal((await stored(db)).revoked_at.getTime(),before.revoked_at.getTime())
})

test('ending an old login does not end a different session or another user', async t => {
  const db = await dbFor(t)
  await rpc(db,'start')
  await rpc(db,'start',{sid:nextSession})
  await rpc(db,'start',{user:bob,sid:bobSession})
  await rpc(db,'end')
  assert.equal((await rpc(db,'status')).active,false)
  assertActive(await rpc(db,'status',{sid:nextSession}),nextSession)
  assertActive(await rpc(db,'status',{user:bob,sid:bobSession}),bobSession,bob)
  // Eine fremde Sitzungs-ID darf Bobs Sitzung nicht widerrufen.
  assert.equal((await rpc(db,'end',{sid:bobSession})).active,false)
  assertActive(await rpc(db,'status',{user:bob,sid:bobSession}),bobSession,bob)
})

test('a genuine new sign-in can start after an old session expired', async t => {
  const db = await dbFor(t)
  await rpc(db,'start')
  await expire(db)
  assert.equal((await rpc(db,'start')).reason,'expired')
  assertActive(await rpc(db,'start',{sid:nextSession}),nextSession)
})

test('deleting the actual Auth session invalidates otherwise active JWT claims', async t => {
  const db = await dbFor(t)
  await rpc(db,'start')
  await db.query('delete from auth.sessions where id=$1',[aliceSession])
  for (const name of ['status','start','touch']) assert.equal((await rpc(db,name)).reason,'invalid')
  await rpc(db,'end')
  assert.ok((await stored(db)).revoked_at)
  const visible = await asCaller(db, tx => tx.query('select * from public.devices'))
  assert.deepEqual(visible.rows,[])
})

test('Auth not_after caps the deadline and prevents later touch or start', async t => {
  const db = await dbFor(t)
  await db.query("update auth.sessions set not_after=clock_timestamp()+interval '5 minutes' where id=$1",[aliceSession])
  const answer=await rpc(db,'start')
  assertActive(answer)
  assert.ok(answer.expiresAt-answer.serverNow<=300_000)
  await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[aliceSession])
  const before=await stored(db)
  for(const name of ['status','touch','start']) assert.equal((await rpc(db,name)).active,false)
  assert.equal((await stored(db)).last_active_at.getTime(),before.last_active_at.getTime())
})

test('restrictive policy combines with existing permissive policies on all six tables', async t => {
  const db = await dbFor(t)
  await rpc(db,'start')
  for (const table of tables) {
    assert.ok((await asCaller(db,tx=>tx.query(`select * from public.${table}`))).rows.length>0)
  }
  await expire(db)
  for (const table of tables) {
    assert.deepEqual((await asCaller(db,tx=>tx.query(`select * from public.${table}`))).rows,[])
    assert.deepEqual((await asCaller(db,tx=>tx.query(`delete from public.${table} returning *`))).rows,[])
    const update = table==='profiles'?'role_id=1':table==='roles'?"name='changed'":"label='changed'"
    assert.deepEqual((await asCaller(db,tx=>tx.query(`update public.${table} set ${update} returning *`))).rows,[])
    const insert = table==='profiles'
      ? `insert into public.profiles values('${charlie}',3)`
      : table==='roles'?"insert into public.roles values(9,'new_role')":`insert into public.${table} values(9,'new')`
    await assert.rejects(asCaller(db,tx=>tx.exec(insert)),{code:'42501'})
  }
})

test('real frontend RPC helpers accept SQL responses and combine with own-profile RLS and expiry', async t => {
  const db = await dbFor(t,false)
  await db.exec(`
    drop policy team_permissive on public.profiles;
    drop policy team_permissive on public.roles;
    grant usage on schema auth to anon,authenticated;
  `)
  await db.exec(ownReadMigration)
  await db.exec(migration)
  const allowedNames = new Set(['inventory_session_start','inventory_session_status','inventory_session_touch','inventory_session_end'])
  const client = {
    async rpc(name, ...parameters) {
      assert.equal(parameters.length,0,'the frontend must not send IDs or timestamps')
      assert.ok(allowedNames.has(name))
      try {
        const data=await asCaller(db,async tx=>(await tx.query(`select public.${name}() response`)).rows[0].response)
        return {data,error:null}
      } catch(error) { return {data:null,error} }
    },
  }
  assertActive(await startInventorySession(client,aliceSession))
  assertActive(await getInventorySession(client,aliceSession))
  assertActive(await touchInventorySession(client,aliceSession))
  const active = await asCaller(db,async tx=>({
    profiles:(await tx.query('select * from public.profiles')).rows,
    roles:(await tx.query('select * from public.roles')).rows,
  }))
  assert.deepEqual(active,{profiles:[{id:alice,role_id:3}],roles:[{id:3,name:'employee'}]})
  await expire(db)
  for(const operation of [getInventorySession,startInventorySession,touchInventorySession]) {
    const status=await operation(client,aliceSession)
    assert.equal(status.active,false)
    assert.equal(status.reason,'expired')
  }
  const expired = await asCaller(db,async tx=>({
    profiles:(await tx.query('select * from public.profiles')).rows,
    roles:(await tx.query('select * from public.roles')).rows,
  }))
  assert.deepEqual(expired,{profiles:[],roles:[]})
  assert.equal((await endInventorySession(client,aliceSession)).reason,'revoked')
  assert.equal((await startInventorySession(client,aliceSession)).reason,'revoked')
})

test('anonymous callers stay denied despite broad future permissive policies', async t => {
  const db = await dbFor(t)
  await rpc(db,'start')
  for (const table of tables) {
    assert.deepEqual((await asCaller(db,tx=>tx.query(`select * from public.${table}`),{role:'anon'})).rows,[])
  }
  assert.equal((await asCaller(db,tx=>tx.query('select public.inventory_session_is_active() active'),{role:'anon'})).rows[0].active,false)
})

test('RPC and private storage grants expose no caller-controlled session rows', async t => {
  const db = await dbFor(t)
  for (const name of ['start','status','touch','end']) {
    const permissions=(await db.query(`select has_function_privilege('anon','public.inventory_session_${name}()','EXECUTE') anon,has_function_privilege('authenticated','public.inventory_session_${name}()','EXECUTE') authenticated`)).rows[0]
    assert.deepEqual(permissions,{anon:false,authenticated:true})
    await assert.rejects(rpc(db,name,{role:'anon'}),{code:'42501'})
  }
  await assert.rejects(asCaller(db,tx=>tx.query('select * from inventory_private.sessions')),{code:'42501'})
  await assert.rejects(asCaller(db,tx=>tx.exec('delete from inventory_private.sessions')),{code:'42501'})
  await assert.rejects(asCaller(db,tx=>tx.query('select inventory_private.jwt_identity()')),{code:'42501'})
  await assert.rejects(asCaller(db,tx=>tx.query('select public.inventory_session_touch($1)',[Date.now()])),{code:'42883'})
})

test('installation preserves existing roles, table privileges and permissive policies', async t => {
  const db=await dbFor(t,false)
  const grants="select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' order by 1,2,3"
  const beforeGrants=(await db.query(grants)).rows
  const beforeRoles=(await db.query('select * from public.roles order by id')).rows
  await db.exec(migration)
  assert.deepEqual((await db.query(grants)).rows,beforeGrants)
  assert.deepEqual((await db.query('select * from public.roles order by id')).rows,beforeRoles)
  const policies=(await db.query("select policyname,permissive,cmd from pg_policies where schemaname='public' order by tablename,policyname")).rows
  assert.equal(policies.filter(p=>p.policyname==='team_permissive').length,6)
  assert.equal(policies.filter(p=>p.policyname==='inventory_active_session_guard'&&p.permissive==='RESTRICTIVE'&&p.cmd==='ALL').length,6)
})

test('disabled RLS or an existing schema/function stops installation atomically', async t => {
  for (const conflict of ['rls','schema','function']) {
    const db=await dbFor(t,false)
    if(conflict==='rls') await db.exec('alter table public.devices disable row level security')
    if(conflict==='schema') await db.exec('create schema inventory_private')
    if(conflict==='function') await db.exec("create function public.inventory_session_touch() returns boolean language sql as 'select true'")
    await assert.rejects(db.exec(migration),{code:'55000'})
    await db.exec('rollback')
    assert.equal((await db.query("select count(*)::int n from pg_policy where polname='inventory_active_session_guard'")).rows[0].n,0)
    assert.equal((await db.query("select to_regclass('inventory_private.sessions') table_id")).rows[0].table_id,null)
  }
})

test('reapplying the migration never overwrites existing session records or policies', async t => {
  const db=await dbFor(t)
  await rpc(db,'start')
  const before=await stored(db)
  await assert.rejects(db.exec(migration),{code:'55000'})
  await db.exec('rollback')
  assert.deepEqual(await stored(db),before)
})
